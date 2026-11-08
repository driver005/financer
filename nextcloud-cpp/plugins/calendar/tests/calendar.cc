#include "collection_server.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>

namespace {

using nc::davobjects::Kind;
using nc::http::Request;
using nc::http::Response;

const std::string ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//"
                        "EN\r\nBEGIN:VEVENT\r\nUID:ev-1@example.org\r\n"
                        "DTSTAMP:20240101T000000Z\r\nDTSTART:20240115T100000Z\r\nDTEND:"
                        "20240115T110000Z\r\nSUMMARY:Lunch & learn\r\n"
                        "END:VEVENT\r\nEND:VCALENDAR\r\n";
const std::string ICS_LATER = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ev-2@example."
                              "org\r\nDTSTART;VALUE=DATE:20240301\r\n"
                              "SUMMARY:March\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const std::string ICS_WEEKLY =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ev-3@example.org\r\nDTSTART:"
    "20230101T090000Z\r\n"
    "RRULE:FREQ=WEEKLY\r\nSUMMARY:Weekly\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const std::string VCF =
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada Lovelace\r\nEMAIL:ada@example.org\r\nEND:VCARD\r\n";

Request
req(std::string method,
    std::string path,
    std::string body = {},
    const std::string& credentials = "alice:alice password")
{
    Request request{
        std::move(method),
        std::move(path),
        std::string{},
        std::move(body),
        std::string{},
        {},
        {}
    };
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

Request with(Request request, std::string name, std::string value)
{
    request.add_header(std::move(name), std::move(value));
    return request;
}

void test_validation()
{
    const Kind calendar = Kind::calendar();
    const Kind book = Kind::addressbook();
    NC_CHECK(nc::davobjects::validate_object(calendar, ICS, 4'096).empty());
    NC_CHECK(!nc::davobjects::validate_object(calendar, "hello", 4'096).empty());
    NC_CHECK(!nc::davobjects::validate_object(calendar, "BEGIN:VCALENDAR\r\nEND:VCALENDAR", 4'096)
                  .empty()); // nothing in it
    NC_CHECK(!nc::davobjects::validate_object(
                  calendar,
                  "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR",
                  4'096
    )
                  .empty());                                               // no UID
    NC_CHECK(!nc::davobjects::validate_object(calendar, ICS, 50).empty()); // too large
    NC_CHECK(!nc::davobjects::validate_object(calendar, VCF, 4'096).empty()
    ); // a contact is not an event
    NC_CHECK(nc::davobjects::validate_object(book, VCF, 4'096).empty());
    NC_CHECK(!nc::davobjects::validate_object(book, ICS, 4'096).empty());
    NC_CHECK(
        !nc::davobjects::validate_object(book, "BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD", 4'096)
             .empty()
    ); // no FN
    NC_CHECK_EQ(nc::davobjects::first_start(ICS), "20240115T100000");
    NC_CHECK_EQ(nc::davobjects::first_start(ICS_LATER), "20240301T000000");
    NC_CHECK(
        nc::davobjects::valid_uri("a-b_c.ics") && !nc::davobjects::valid_uri("a/b") &&
        !nc::davobjects::valid_uri("..") && !nc::davobjects::valid_uri("")
    );
}

} // namespace

int main()
{
    test_validation();

    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-dav-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"calendar", "contacts", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{4});
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string cal = "/remote.php/dav/calendars/alice";
    const std::string book = "/remote.php/dav/addressbooks/users/alice";

    // ---- discovery ------------------------------------------------------------------------------
    const Response wellknown = kernel.handle(Request{"GET", "/.well-known/caldav"});
    NC_CHECK_EQ(wellknown.get_status(), 301);
    NC_CHECK_EQ(std::string(wellknown.header("Location")), "/remote.php/dav/");
    NC_CHECK_EQ(kernel.handle(Request{"GET", "/.well-known/carddav"}).get_status(), 301);
    NC_CHECK_EQ(kernel.handle(Request{"PROPFIND", "/remote.php/dav"}).get_status(), 401);
    NC_CHECK(
        kernel.handle(req("PROPFIND", "/remote.php/dav"))
            .get_body()
            .find("/remote.php/dav/principals/users/alice/") != std::string::npos
    );
    const auto principal =
        kernel.handle(req("PROPFIND", "/remote.php/dav/principals/users/alice")).get_body();
    NC_CHECK(
        principal.find("<d:href>/remote.php/dav/calendars/alice/</d:href></cal:calendar-home-set>"
        ) != std::string::npos
    );
    NC_CHECK(
        principal.find("addressbook-home-set") != std::string::npos
    ); // contacts plugin is loaded
    NC_CHECK_EQ(
        kernel.handle(req("PROPFIND", "/remote.php/dav/principals/users/bob")).get_status(),
        403
    );

    // ---- the calendar home has the default calendar -------------------------------------------
    const auto home = kernel.handle(with(req("PROPFIND", cal), "Depth", "1")).get_body();
    NC_CHECK(home.find("<d:href>" + cal + "/personal/</d:href>") != std::string::npos);
    NC_CHECK(home.find("<cal:calendar/>") != std::string::npos);
    NC_CHECK(home.find("<d:displayname>Personal</d:displayname>") != std::string::npos);
    NC_CHECK(home.find("cal:comp name=\"VEVENT\"") != std::string::npos);

    // Nobody reaches another person's calendars.
    NC_CHECK_EQ(kernel.handle(req("PROPFIND", cal, "", "bob:bob password")).get_status(), 403);
    NC_CHECK_EQ(
        kernel.handle(req("GET", cal + "/personal/x.ics", "", "bob:bob password")).get_status(),
        403
    );
    NC_CHECK_EQ(kernel.handle(Request{"PROPFIND", std::string{cal}}).get_status(), 401);

    // ---- objects --------------------------------------------------------------------------------
    NC_CHECK_EQ(kernel.handle(req("PUT", cal + "/personal/ev1.ics", ICS)).get_status(), 201);
    const Response replaced = kernel.handle(req("PUT", cal + "/personal/ev1.ics", ICS));
    NC_CHECK_EQ(replaced.get_status(), 204);
    const std::string etag{replaced.header("ETag")};
    NC_CHECK(!etag.empty());
    NC_CHECK_EQ(
        kernel.handle(with(req("PUT", cal + "/personal/ev1.ics", ICS), "If-None-Match", "*"))
            .get_status(),
        412
    );
    NC_CHECK_EQ(
        kernel
            .handle(with(req("PUT", cal + "/personal/ev1.ics", ICS_LATER), "If-Match", "\"stale\""))
            .get_status(),
        412
    );
    NC_CHECK_EQ(
        kernel.handle(with(req("PUT", cal + "/personal/ev1.ics", ICS_LATER), "If-Match", etag))
            .get_status(),
        204
    );
    NC_CHECK_EQ(kernel.handle(req("PUT", cal + "/personal/ev1.ics", ICS)).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("PUT", cal + "/personal/ev2.ics", ICS_LATER)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("PUT", cal + "/personal/ev3.ics", ICS_WEEKLY)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(req("PUT", cal + "/personal/bad.ics", "not a calendar")).get_status(),
        415
    );
    NC_CHECK_EQ(kernel.handle(req("PUT", cal + "/personal/contact.ics", VCF)).get_status(), 415);
    NC_CHECK_EQ(kernel.handle(req("PUT", cal + "/nowhere/ev.ics", ICS)).get_status(), 409);
    NC_CHECK_EQ(kernel.handle(req("PUT", cal + "/personal/..%2Fx.ics", ICS)).get_status(), 400);

    const Response got = kernel.handle(req("GET", cal + "/personal/ev1.ics"));
    NC_CHECK_EQ(got.get_status(), 200);
    NC_CHECK_EQ(got.get_body(), ICS);
    NC_CHECK(got.get_content_type().find("text/calendar") != std::string::npos);
    NC_CHECK_EQ(kernel.handle(req("GET", cal + "/personal/none.ics")).get_status(), 404);

    // ---- listing and reports --------------------------------------------------------------------
    const auto listing =
        kernel.handle(with(req("PROPFIND", cal + "/personal"), "Depth", "1")).get_body();
    NC_CHECK(
        listing.find(cal + "/personal/ev1.ics") != std::string::npos &&
        listing.find(cal + "/personal/ev2.ics") != std::string::npos
    );
    NC_CHECK(listing.find("<cs:getctag>") != std::string::npos);

    const std::string multiget =
        "<?xml version=\"1.0\"?><c:calendar-multiget xmlns:d=\"DAV:\" "
        "xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:getetag/><c:calendar-data/></d:prop>"
        "<d:href>" +
        cal + "/personal/ev2.ics</d:href><d:href>" + cal +
        "/personal/missing.ics</d:href></c:calendar-multiget>";
    const auto multi = kernel.handle(req("REPORT", cal + "/personal", multiget)).get_body();
    NC_CHECK(
        multi.find("<cal:calendar-data>") != std::string::npos &&
        multi.find("SUMMARY:March") != std::string::npos
    );
    NC_CHECK(multi.find("HTTP/1.1 404 Not Found") != std::string::npos);
    NC_CHECK(multi.find("Lunch") == std::string::npos);

    const auto query = [&](const std::string& range)
    {
        return kernel
            .handle(
                req("REPORT",
                    cal + "/personal",
                    "<c:calendar-query xmlns:c=\"urn:ietf:params:xml:ns:caldav\" "
                    "xmlns:d=\"DAV:\"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter "
                    "name=\"VCALENDAR\"><c:comp-filter name=\"VEVENT\">" +
                        range + "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>")
            )
            .get_body();
    };
    const auto all = query("");
    NC_CHECK(
        all.find("ev1.ics") != std::string::npos && all.find("ev2.ics") != std::string::npos &&
        all.find("ev3.ics") != std::string::npos
    );
    const auto january =
        query("<c:time-range start=\"20240101T000000Z\" end=\"20240201T000000Z\"/>");
    NC_CHECK(january.find("ev1.ics") != std::string::npos);
    NC_CHECK(january.find("ev2.ics") == std::string::npos); // March is outside
    NC_CHECK(
        january.find("ev3.ics") != std::string::npos
    ); // a recurring event may fall in any range
    NC_CHECK(
        query("<c:time-range start=\"20250101T000000Z\" end=\"20250201T000000Z\"/>")
            .find("ev1.ics") == std::string::npos
    );

    // Sync: the same token gets nothing, a changed collection gets everything.
    const auto before =
        kernel.handle(with(req("PROPFIND", cal + "/personal"), "Depth", "0")).get_body();
    const std::string token = before.substr(before.find("<cs:getctag>") + 12, 16);
    const std::string sync = "<d:sync-collection xmlns:d=\"DAV:\"><d:sync-token>" + token +
                             "</d:sync-token></d:sync-collection>";
    NC_CHECK(
        kernel.handle(req("REPORT", cal + "/personal", sync)).get_body().find("ev1.ics") ==
        std::string::npos
    );
    NC_CHECK_EQ(kernel.handle(req("DELETE", cal + "/personal/ev3.ics")).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("DELETE", cal + "/personal/ev3.ics")).get_status(), 404);
    NC_CHECK(
        kernel.handle(req("REPORT", cal + "/personal", sync)).get_body().find("ev1.ics") !=
        std::string::npos
    );

    // ---- more calendars -------------------------------------------------------------------------
    NC_CHECK_EQ(
        kernel
            .handle(
                req("MKCALENDAR",
                    cal + "/work",
                    "<c:mkcalendar xmlns:c=\"urn:ietf:params:xml:ns:caldav\" "
                    "xmlns:d=\"DAV:\"><d:set><d:prop><d:displayname>Work "
                    "stuff</d:displayname></d:prop></d:set></c:mkcalendar>")
            )
            .get_status(),
        201
    );
    NC_CHECK_EQ(kernel.handle(req("MKCALENDAR", cal + "/work")).get_status(), 405);
    NC_CHECK(
        kernel.handle(with(req("PROPFIND", cal), "Depth", "1")).get_body().find("Work stuff") !=
        std::string::npos
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PROPPATCH",
                    cal + "/work",
                    "<d:propertyupdate "
                    "xmlns:d=\"DAV:\"><d:set><d:prop><d:displayname>Renamed</d:displayname></"
                    "d:prop></d:set></d:propertyupdate>")
            )
            .get_status(),
        207
    );
    NC_CHECK(
        kernel.handle(with(req("PROPFIND", cal), "Depth", "1")).get_body().find("Renamed") !=
        std::string::npos
    );
    NC_CHECK_EQ(kernel.handle(req("DELETE", cal + "/work")).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("PROPFIND", cal + "/work")).get_status(), 404);

    // ---- address books --------------------------------------------------------------------------
    NC_CHECK(
        kernel.handle(with(req("PROPFIND", book), "Depth", "1"))
            .get_body()
            .find("<card:addressbook/>") != std::string::npos
    );
    NC_CHECK_EQ(kernel.handle(req("PUT", book + "/contacts/ada.vcf", VCF)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("PUT", book + "/contacts/event.vcf", ICS)).get_status(), 415);
    NC_CHECK_EQ(kernel.handle(req("GET", book + "/contacts/ada.vcf")).get_body(), VCF);
    const auto cards =
        kernel
            .handle(req(
                "REPORT",
                book + "/contacts",
                "<card:addressbook-query xmlns:card=\"urn:ietf:params:xml:ns:carddav\" "
                "xmlns:d=\"DAV:\"><d:prop><card:address-data/></d:prop></card:addressbook-query>"
            ))
            .get_body();
    NC_CHECK(
        cards.find("<card:address-data>") != std::string::npos &&
        cards.find("Ada Lovelace") != std::string::npos
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", book + "/contacts/ada.vcf", "", "bob:bob password")).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", "/remote.php/dav/calendars/alice/contacts/ada.vcf")).get_status(),
        409
    ); // not a calendar

    // The two kinds do not share collections even under the same name.
    NC_CHECK_EQ(kernel.handle(req("PROPFIND", cal + "/contacts")).get_status(), 404);

    // Deleting an account removes its calendars and contacts.
    NC_CHECK_EQ(kernel.run_command("user:delete", {"alice"}, out), 0);
    NC_CHECK_EQ(
        kernel.get_services()
            .call("db.query", "sql=SELECT+COUNT%28*%29+AS+n+FROM+nc_dav_collections")
            .get_body(),
        "n=0\n"
    );

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
