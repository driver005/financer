#include "collection_server.h"
#include "itip.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <cstdlib>
#include <filesystem>
#include <vector>

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

std::string event_with(
    const std::string& uid,
    const std::string& organizer,
    const std::vector<std::string>& attendees
)
{
    std::string text =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VEVENT\r\nUID:" + uid +
        "\r\nDTSTAMP:20240101T000000Z\r\nDTSTART:20240115T100000Z\r\nDTEND:20240115T110000Z\r\n"
        "SUMMARY:Planning\r\nORGANIZER;CN=Alice:mailto:" +
        organizer + "\r\n";
    for (const std::string& attendee: attendees) {
        text += "ATTENDEE;" + attendee + "\r\n";
    }
    return text + "END:VEVENT\r\nEND:VCALENDAR\r\n";
}

void test_itip_text()
{
    namespace itip = nc::davobjects::itip;
    const std::string folded =
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u-1\r\nSUMMARY:A very long\r\n  title\r\n"
        "ORGANIZER;CN=\"Doe: John\":mailto:Boss@Example.org\r\n"
        "ATTENDEE;CN=\"Ann; B\";PARTSTAT=accepted;RSVP=TRUE:mailto:ann@example.org\r\n"
        "ATTENDEE:MAILTO:Bob@example.org\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    const itip::Event event = itip::parse(folded);
    NC_CHECK(event.valid);
    NC_CHECK_EQ(event.uid, "u-1");
    NC_CHECK_EQ(event.summary, "A very long title");
    NC_CHECK_EQ(event.organizer, "boss@example.org");
    NC_CHECK_EQ(event.attendees.size(), std::size_t{2});
    NC_CHECK_EQ(event.attendees[0].email, "ann@example.org");
    NC_CHECK_EQ(event.attendees[0].partstat, "ACCEPTED");
    NC_CHECK_EQ(event.attendees[1].partstat, "NEEDS-ACTION");
    NC_CHECK(!itip::parse("not a calendar").valid);

    const std::string requested = itip::with_method(folded, "REQUEST");
    NC_CHECK(requested.find("METHOD:REQUEST\r\nBEGIN:VEVENT") != std::string::npos);
    NC_CHECK(itip::with_method(requested, "CANCEL").find("METHOD:REQUEST") == std::string::npos);
    const std::string answered = itip::set_partstat(folded, "BOB@example.org", "DECLINED");
    NC_CHECK(itip::parse(answered).attendees[1].partstat == "DECLINED");
    NC_CHECK(itip::parse(answered).attendees[0].partstat == "ACCEPTED"); // others untouched
    const std::string changed = itip::set_partstat(folded, "ann@example.org", "TENTATIVE");
    NC_CHECK(changed.find("CN=\"Ann; B\"") != std::string::npos); // other parameters stay
    NC_CHECK(changed.find("PARTSTAT=accepted") == std::string::npos);
    const std::string reply = itip::reply_for(folded, "ann@example.org", "ACCEPTED");
    NC_CHECK(reply.find("METHOD:REPLY") != std::string::npos);
    NC_CHECK(reply.find("ORGANIZER:mailto:boss@example.org") != std::string::npos);
    NC_CHECK(reply.find("bob@example.org") == std::string::npos); // only the one who answers
    NC_CHECK_EQ(itip::uri_for("a/b@c d"), "a_b_c_d");
    NC_CHECK_EQ(itip::uri_for(""), "event");
}

void test_scheduling()
{
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-itip-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"calendar", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    for (const char* name: {"alice", "bob"}) {
        ::setenv("OC_PASS", (std::string{name} + " password").c_str(), 1);
        NC_CHECK_EQ(
            kernel.run_command(
                "user:add",
                {name, std::string{"--email="} + name + "@example.org"},
                out
            ),
            0
        );
    }
    ::unsetenv("OC_PASS");
    const std::string bob = "bob:bob password";
    const std::string a = "/remote.php/dav/calendars/alice";
    const std::string b = "/remote.php/dav/calendars/bob";
    const auto inbox_of = [&](const std::string& home, const std::string& user)
    {
        return kernel.handle(with(req("PROPFIND", home + "/inbox", "", user), "Depth", "1"))
            .get_body();
    };
    const std::string bob_part = "PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@example.org";
    const std::string external = "PARTSTAT=NEEDS-ACTION:mailto:guest@elsewhere.org";

    // Discovery names the inbox and the address.
    const auto principal =
        kernel.handle(req("PROPFIND", "/remote.php/dav/principals/users/alice")).get_body();
    NC_CHECK(principal.find("/remote.php/dav/calendars/alice/inbox/") != std::string::npos);
    NC_CHECK(principal.find("mailto:alice@example.org") != std::string::npos);

    // Alice invites bob (and someone without an account, who would get a mail).
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    a + "/personal/plan.ics",
                    event_with("plan-1", "alice@example.org", {bob_part, external}))
            )
            .get_status(),
        201
    );
    const auto invitation = kernel.handle(req("GET", b + "/inbox/plan-1-request.ics", "", bob));
    NC_CHECK_EQ(invitation.get_status(), 200);
    NC_CHECK(invitation.get_body().find("METHOD:REQUEST") != std::string::npos);
    NC_CHECK(invitation.get_body().find("UID:plan-1") != std::string::npos);
    NC_CHECK(inbox_of(b, bob).find("<cal:schedule-inbox/>") != std::string::npos);
    NC_CHECK(
        kernel.handle(req("GET", a + "/inbox/plan-1-request.ics")).get_status() == 404 ||
        kernel.handle(req("GET", a + "/inbox/plan-1-request.ics")).get_status() == 409
    ); // not to herself

    // Bob accepts by saving his copy; alice's inbox gets the reply and her copy shows it.
    const std::string accepted = event_with(
        "plan-1",
        "alice@example.org",
        {"PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:bob@example.org", external}
    );
    NC_CHECK_EQ(
        kernel.handle(req("PUT", b + "/personal/plan.ics", accepted, bob)).get_status(),
        201
    );
    const auto reply = kernel.handle(req("GET", a + "/inbox/plan-1-reply-bob_example_org.ics"));
    NC_CHECK_EQ(reply.get_status(), 200);
    NC_CHECK(reply.get_body().find("METHOD:REPLY") != std::string::npos);
    NC_CHECK(reply.get_body().find("PARTSTAT=ACCEPTED") != std::string::npos);
    const std::string hers = kernel.handle(req("GET", a + "/personal/plan.ics")).get_body();
    NC_CHECK(hers.find("PARTSTAT=ACCEPTED") != std::string::npos);
    NC_CHECK(hers.find("guest@elsewhere.org") != std::string::npos);
    // Saving the same answer again says nothing new.
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", a + "/inbox/plan-1-reply-bob_example_org.ics")).get_status(),
        204
    );
    NC_CHECK_EQ(
        kernel.handle(req("PUT", b + "/personal/plan.ics", accepted, bob)).get_status(),
        204
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", a + "/inbox/plan-1-reply-bob_example_org.ics")).get_status(),
        404
    );

    // Dropping bob from the event cancels it for him.
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    a + "/personal/plan.ics",
                    event_with("plan-1", "alice@example.org", {external}))
            )
            .get_status(),
        204
    );
    const auto cancelled = kernel.handle(req("GET", b + "/inbox/plan-1-cancel.ics", "", bob));
    NC_CHECK_EQ(cancelled.get_status(), 200);
    NC_CHECK(cancelled.get_body().find("METHOD:CANCEL") != std::string::npos);

    // Deleting an event cancels it for the attendees; an attendee who deletes declines.
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    a + "/personal/two.ics",
                    event_with("plan-2", "alice@example.org", {bob_part}))
            )
            .get_status(),
        201
    );
    NC_CHECK_EQ(kernel.handle(req("DELETE", a + "/personal/two.ics")).get_status(), 204);
    NC_CHECK_EQ(
        kernel.handle(req("GET", b + "/inbox/plan-2-cancel.ics", "", bob)).get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    a + "/personal/three.ics",
                    event_with("plan-3", "alice@example.org", {bob_part}))
            )
            .get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    b + "/personal/three.ics",
                    event_with("plan-3", "alice@example.org", {bob_part}),
                    bob)
            )
            .get_status(),
        201
    );
    NC_CHECK_EQ(kernel.handle(req("DELETE", b + "/personal/three.ics", "", bob)).get_status(), 204);
    const auto declined = kernel.handle(req("GET", a + "/inbox/plan-3-reply-bob_example_org.ics"));
    NC_CHECK_EQ(declined.get_status(), 200);
    NC_CHECK(declined.get_body().find("PARTSTAT=DECLINED") != std::string::npos);

    // An event organized by someone else, saved by a person who is not on it, sends nothing.
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PUT",
                    b + "/personal/other.ics",
                    event_with(
                        "plan-4",
                        "carol@example.org",
                        {"PARTSTAT=NEEDS-ACTION:mailto:dave@example.org"}
                    ),
                    bob)
            )
            .get_status(),
        201
    );
    NC_CHECK(inbox_of(a, "alice:alice password").find("plan-4") == std::string::npos);
    // Nobody writes into somebody else's inbox directly.
    NC_CHECK_EQ(kernel.handle(req("PUT", a + "/inbox/fake.ics", ICS, bob)).get_status(), 403);
    kernel.stop();
    std::filesystem::remove_all(dir);
}

const std::string CAROL = "carol:carol password";

void test_sharing()
{
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-davshare-" + nc::util::random_hex(4)))
            .string();
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
    std::string out;
    for (const char* name: {"alice", "bob", "carol"}) {
        ::setenv("OC_PASS", (std::string{name} + " password").c_str(), 1);
        NC_CHECK_EQ(kernel.run_command("user:add", {name}, out), 0);
    }
    ::unsetenv("OC_PASS");
    const std::string alice_cal = "/remote.php/dav/calendars/alice";
    const std::string bob_cal = "/remote.php/dav/calendars/bob";
    const std::string bob = "bob:bob password";
    const auto share_xml = [](const std::string& who, const char* access)
    {
        return std::string{"<?xml version=\"1.0\"?><cs:share xmlns:d=\"DAV:\" "
                           "xmlns:cs=\"http://calendarserver.org/ns/"
                           "\"><cs:set><d:href>principal:principals/users/"} +
               who + "</d:href><cs:" + access + "/></cs:set></cs:share>";
    };
    NC_CHECK_EQ(kernel.handle(req("PUT", alice_cal + "/personal/ev1.ics", ICS)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("MKCALENDAR", alice_cal + "/team")).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("PUT", alice_cal + "/team/t1.ics", ICS_LATER)).get_status(), 201);

    // Nothing is shared yet.
    NC_CHECK(
        kernel.handle(with(req("PROPFIND", bob_cal, "", bob), "Depth", "1"))
            .get_body()
            .find("shared_by") == std::string::npos
    );

    // Only the owner shares; the person must exist and cannot be the owner.
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/team", share_xml("bob", "read"), bob)).get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/team", share_xml("nobody", "read"))).get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/team", share_xml("alice", "read"))).get_status(),
        400
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/team", share_xml("bob", "read"))).get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/personal", share_xml("carol", "read-write")))
            .get_status(),
        200
    );

    // The shared calendar shows up in bob's home, with its owner and what bob may do.
    const auto home =
        kernel.handle(with(req("PROPFIND", bob_cal, "", bob), "Depth", "1")).get_body();
    NC_CHECK(
        home.find("<d:href>" + bob_cal + "/team_shared_by_alice/</d:href>") != std::string::npos
    );
    NC_CHECK(home.find("/remote.php/dav/principals/users/alice/") != std::string::npos);
    NC_CHECK(home.find("personal_shared_by_alice") == std::string::npos); // that one is carol's
    const std::string shared = bob_cal + "/team_shared_by_alice";
    NC_CHECK_EQ(kernel.handle(req("GET", shared + "/t1.ics", "", bob)).get_body(), ICS_LATER);
    const auto listing =
        kernel.handle(with(req("PROPFIND", shared, "", bob), "Depth", "1")).get_body();
    NC_CHECK(listing.find("t1.ics") != std::string::npos);
    NC_CHECK(listing.find("<d:write/>") == std::string::npos); // read-only
    NC_CHECK(
        kernel
            .handle(
                req("REPORT",
                    shared,
                    "<c:calendar-query xmlns:c=\"urn:ietf:params:xml:ns:caldav\"/>",
                    bob)
            )
            .get_body()
            .find("Lunch") == std::string::npos
    );

    // Read-only means no changes, no renaming, no sharing on.
    NC_CHECK_EQ(kernel.handle(req("PUT", shared + "/new.ics", ICS, bob)).get_status(), 403);
    NC_CHECK_EQ(kernel.handle(req("DELETE", shared + "/t1.ics", "", bob)).get_status(), 403);
    NC_CHECK_EQ(
        kernel
            .handle(
                req("PROPPATCH",
                    shared,
                    "<d:propertyupdate "
                    "xmlns:d=\"DAV:\"><d:set><d:prop><d:displayname>Mine</d:displayname></d:prop></"
                    "d:set></d:propertyupdate>",
                    bob)
            )
            .get_status(),
        403
    );
    NC_CHECK_EQ(
        kernel.handle(req("POST", shared, share_xml("carol", "read"), bob)).get_status(),
        403
    );
    // Nobody else sees it, and a made-up name opens nothing.
    NC_CHECK_EQ(
        kernel
            .handle(
                req("GET", "/remote.php/dav/calendars/carol/team_shared_by_alice/t1.ics", "", CAROL)
            )
            .get_status(),
        409
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", bob_cal + "/personal_shared_by_alice/ev1.ics", "", bob))
            .get_status(),
        409
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", bob_cal + "/x_shared_by_alice/ev1.ics", "", bob)).get_status(),
        409
    );
    NC_CHECK_EQ(
        kernel.handle(req("MKCALENDAR", bob_cal + "/fake_shared_by_alice", "", bob)).get_status(),
        400
    );

    // Read and write: carol changes alice's personal calendar.
    const std::string carol_shared = "/remote.php/dav/calendars/carol/personal_shared_by_alice";
    NC_CHECK_EQ(
        kernel.handle(req("PUT", carol_shared + "/fromcarol.ics", ICS_WEEKLY, CAROL)).get_status(),
        201
    );
    NC_CHECK_EQ(
        kernel.handle(req("GET", alice_cal + "/personal/fromcarol.ics")).get_body(),
        ICS_WEEKLY
    );
    NC_CHECK_EQ(
        kernel.handle(req("DELETE", carol_shared + "/ev1.ics", "", CAROL)).get_status(),
        204
    );
    NC_CHECK_EQ(kernel.handle(req("GET", alice_cal + "/personal/ev1.ics")).get_status(), 404);
    // Her own "personal" is a different calendar.
    NC_CHECK_EQ(
        kernel
            .handle(req("GET", "/remote.php/dav/calendars/carol/personal/fromcarol.ics", "", CAROL))
            .get_status(),
        404
    );

    // Changing the access, removing a person, and leaving a shared calendar.
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/team", share_xml("bob", "read-write")))
            .get_status(),
        200
    );
    NC_CHECK_EQ(kernel.handle(req("PUT", shared + "/new.ics", ICS, bob)).get_status(), 201);
    NC_CHECK_EQ(kernel.handle(req("DELETE", shared, "", bob)).get_status(), 204); // bob leaves
    NC_CHECK_EQ(kernel.handle(req("GET", shared + "/t1.ics", "", bob)).get_status(), 409);
    NC_CHECK_EQ(
        kernel.handle(req("GET", alice_cal + "/team/t1.ics")).get_body(),
        ICS_LATER
    ); // alice keeps hers
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/team", share_xml("bob", "read"))).get_status(),
        200
    );
    const std::string remove_bob =
        "<cs:share xmlns:d=\"DAV:\" "
        "xmlns:cs=\"http://calendarserver.org/ns/\"><cs:remove><d:href>principal:principals/users/"
        "bob</d:href></cs:remove></cs:share>";
    NC_CHECK_EQ(kernel.handle(req("POST", alice_cal + "/team", remove_bob)).get_status(), 200);
    NC_CHECK_EQ(kernel.handle(req("GET", shared + "/t1.ics", "", bob)).get_status(), 409);

    // Deleting the calendar takes the shares with it.
    NC_CHECK_EQ(
        kernel.handle(req("POST", alice_cal + "/team", share_xml("bob", "read"))).get_status(),
        200
    );
    NC_CHECK_EQ(kernel.handle(req("DELETE", alice_cal + "/team")).get_status(), 204);
    NC_CHECK_EQ(kernel.handle(req("GET", shared + "/t1.ics", "", bob)).get_status(), 409);
    // Address books share the same way.
    const std::string book = "/remote.php/dav/addressbooks/users/alice";
    NC_CHECK_EQ(kernel.handle(req("PUT", book + "/contacts/ada.vcf", VCF)).get_status(), 201);
    NC_CHECK_EQ(
        kernel.handle(req("POST", book + "/contacts", share_xml("bob", "read"))).get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel
            .handle(
                req("GET",
                    "/remote.php/dav/addressbooks/users/bob/contacts_shared_by_alice/ada.vcf",
                    "",
                    bob)
            )
            .get_body(),
        VCF
    );
    // A deleted account loses what was shared with it.
    kernel.get_events().publish("user.deleted", "id=bob");
    NC_CHECK_EQ(
        kernel
            .handle(
                req("GET",
                    "/remote.php/dav/addressbooks/users/bob/contacts_shared_by_alice/ada.vcf",
                    "",
                    bob)
            )
            .get_status(),
        409
    );
    kernel.stop();
    std::filesystem::remove_all(dir);
}

int main()
{
    test_validation();
    test_itip_text();
    test_scheduling();
    test_sharing();

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
