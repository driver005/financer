use super::*;
use financer_mail_core::{Address, CalendarEvent, EventSource, Template, TemplateKind};
use time::macros::datetime;

async fn store() -> MailStore {
    MailStore::connect("sqlite::memory:").await.unwrap()
}

fn addr(s: &str) -> Address {
    Address::parse(s).unwrap()
}

fn msg(id: &str, subject: &str, from: &str, at: i64) -> NewMessage {
    NewMessage {
        message_id: id.into(),
        folder: "INBOX".into(),
        uid: Some(7),
        in_reply_to: None,
        references: vec![],
        subject: subject.into(),
        from: addr(from),
        to: vec![addr("Paul <paul@x.de>")],
        cc: vec![],
        sent_at: at,
        body: format!("body of {id}"),
        snippet: format!("snippet of {id}"),
        outgoing: false,
        seen: false,
        automated: false,
    }
}

fn event(uid: &str, title: &str, start: PrimitiveDateTime) -> CalendarEvent {
    CalendarEvent {
        uid: uid.into(),
        title: title.into(),
        start,
        end: None,
        all_day: false,
        location: None,
        description: None,
        organizer: None,
        source: EventSource::Invite,
        sequence: 0,
        cancelled: false,
        recurrence: None,
        note: None,
    }
}

#[tokio::test]
async fn stores_a_message_once() {
    let s = store().await;
    let m = msg("a@x", "Hallo", "Max <max@y.de>", 100);
    let id = s
        .insert_message(&m, 1)
        .await
        .unwrap()
        .expect("first insert");
    assert_eq!(
        s.insert_message(&m, 2).await.unwrap(),
        None,
        "same Message-ID"
    );
    assert_eq!(s.message_count().await.unwrap(), 1);
    let back = s.message(id).await.unwrap().unwrap();
    assert_eq!(back.message, m);
    assert_eq!(
        s.message_by_message_id("a@x").await.unwrap().unwrap().id,
        id
    );
    assert!(s.message_by_message_id("nope").await.unwrap().is_none());
}

#[tokio::test]
async fn metas_carry_no_body_and_come_newest_first() {
    let s = store().await;
    let mut m = msg("a@x", "Eins", "max@y.de", 100);
    m.references = vec!["r@x".into()];
    m.in_reply_to = Some("r@x".into());
    s.insert_message(&m, 1).await.unwrap();
    s.insert_message(&msg("b@x", "Zwei", "max@y.de", 300), 1)
        .await
        .unwrap();
    s.insert_message(&msg("c@x", "Drei", "max@y.de", 200), 1)
        .await
        .unwrap();
    let metas = s.metas(10).await.unwrap();
    assert_eq!(
        metas
            .iter()
            .map(|m| m.message_id.as_str())
            .collect::<Vec<_>>(),
        ["b@x", "c@x", "a@x"]
    );
    let a = metas.iter().find(|m| m.message_id == "a@x").unwrap();
    assert_eq!(a.references, ["r@x"]);
    assert_eq!(a.in_reply_to.as_deref(), Some("r@x"));
    assert_eq!(a.to[0].email, "paul@x.de");
    assert_eq!(s.metas(2).await.unwrap().len(), 2);
}

#[tokio::test]
async fn very_long_bodies_are_cut_on_a_character_boundary() {
    let s = store().await;
    let mut m = msg("a@x", "Lang", "max@y.de", 100);
    m.body = "ä".repeat(MAX_BODY_BYTES);
    let id = s.insert_message(&m, 1).await.unwrap().unwrap();
    let body = s.message(id).await.unwrap().unwrap().message.body;
    assert!(body.len() < MAX_BODY_BYTES + 40);
    assert!(body.ends_with("[message shortened]"));
}

#[tokio::test]
async fn reading_marks_messages_seen_and_updates_the_unread_count() {
    let s = store().await;
    let a = s
        .insert_message(&msg("a@x", "1", "max@y.de", 100), 1)
        .await
        .unwrap()
        .unwrap();
    let b = s
        .insert_message(&msg("b@x", "2", "max@y.de", 200), 1)
        .await
        .unwrap()
        .unwrap();
    let mut shop = msg("c@x", "3", "news@shop.de", 300);
    shop.automated = true;
    s.insert_message(&shop, 1).await.unwrap();
    assert_eq!(
        s.unread_count().await.unwrap(),
        2,
        "automated mail does not count"
    );
    assert_eq!(s.mark_seen(&[a]).await.unwrap(), 1);
    assert_eq!(s.mark_seen(&[a]).await.unwrap(), 0, "already seen");
    assert_eq!(s.unread_count().await.unwrap(), 1);
    s.mark_seen(&[b]).await.unwrap();
    assert_eq!(s.unread_count().await.unwrap(), 0);
}

#[tokio::test]
async fn full_messages_come_oldest_first() {
    let s = store().await;
    let a = s
        .insert_message(&msg("a@x", "1", "max@y.de", 300), 1)
        .await
        .unwrap()
        .unwrap();
    let b = s
        .insert_message(&msg("b@x", "2", "max@y.de", 100), 1)
        .await
        .unwrap()
        .unwrap();
    let got = s.messages(&[a, b]).await.unwrap();
    assert_eq!(got.iter().map(|m| m.id).collect::<Vec<_>>(), [b, a]);
}

#[tokio::test]
async fn a_new_event_is_added_and_the_same_one_is_unchanged() {
    let s = store().await;
    let e = event("u1", "Kickoff", datetime!(2026-11-05 14:00));
    assert_eq!(
        s.upsert_event(&e, Some(1), 10).await.unwrap(),
        Upsert::Created
    );
    assert_eq!(
        s.upsert_event(&e, Some(1), 11).await.unwrap(),
        Upsert::Unchanged
    );
    let list = s.events("2026-11-01", "2026-11-30", false).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].event, e);
    assert_eq!(list[0].message_row, Some(1));
}

#[tokio::test]
async fn a_newer_version_updates_and_an_older_one_is_ignored() {
    let s = store().await;
    let mut e = event("u1", "Kickoff", datetime!(2026-11-05 14:00));
    e.sequence = 1;
    s.upsert_event(&e, None, 10).await.unwrap();
    let mut moved = e.clone();
    moved.sequence = 2;
    moved.start = datetime!(2026-11-06 10:00);
    moved.title = "Kickoff (verschoben)".into();
    assert_eq!(
        s.upsert_event(&moved, None, 11).await.unwrap(),
        Upsert::Updated
    );
    assert_eq!(
        s.upsert_event(&e, None, 12).await.unwrap(),
        Upsert::Ignored,
        "older sequence"
    );
    let list = s.events("2026-11-01", "2026-11-30", false).await.unwrap();
    assert_eq!(list[0].event.title, "Kickoff (verschoben)");
    assert_eq!(list[0].event.start, datetime!(2026-11-06 10:00));
}

#[tokio::test]
async fn a_cancellation_cancels_and_is_hidden_unless_asked_for() {
    let s = store().await;
    let e = event("u1", "Kickoff", datetime!(2026-11-05 14:00));
    s.upsert_event(&e, None, 10).await.unwrap();
    let mut cancel = e.clone();
    cancel.cancelled = true;
    cancel.sequence = 1;
    assert_eq!(
        s.upsert_event(&cancel, None, 11).await.unwrap(),
        Upsert::Updated
    );
    assert!(s
        .events("2026-11-01", "2026-11-30", false)
        .await
        .unwrap()
        .is_empty());
    let all = s.events("2026-11-01", "2026-11-30", true).await.unwrap();
    assert_eq!(all[0].status, EventStatus::Cancelled);
    assert!(all[0].event.cancelled);
    // a cancellation of something never added is dropped
    let mut unknown = event("u9", "x", datetime!(2026-11-09 09:00));
    unknown.cancelled = true;
    assert_eq!(
        s.upsert_event(&unknown, None, 12).await.unwrap(),
        Upsert::Ignored
    );
}

#[tokio::test]
async fn a_dismissed_event_stays_dismissed_when_the_invitation_is_read_again() {
    let s = store().await;
    let e = event("u1", "Kickoff", datetime!(2026-11-05 14:00));
    s.upsert_event(&e, None, 10).await.unwrap();
    let id = s.events("2026-11-01", "2026-11-30", false).await.unwrap()[0].id;
    assert!(s
        .set_event_status(id, EventStatus::Dismissed, 11)
        .await
        .unwrap());
    assert!(s
        .events("2026-11-01", "2026-11-30", true)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(s.upsert_event(&e, None, 12).await.unwrap(), Upsert::Ignored);
    // bringing it back
    s.set_event_status(id, EventStatus::Active, 13)
        .await
        .unwrap();
    assert_eq!(
        s.events("2026-11-01", "2026-11-30", false)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn a_guess_from_text_does_not_overwrite_an_invitation() {
    let s = store().await;
    let invite = event("u1", "Kickoff", datetime!(2026-11-05 14:00));
    s.upsert_event(&invite, None, 10).await.unwrap();
    let mut guess = event("u1", "Kickoff?", datetime!(2026-11-05 15:00));
    guess.source = EventSource::Text;
    assert_eq!(
        s.upsert_event(&guess, None, 11).await.unwrap(),
        Upsert::Ignored
    );
}

#[tokio::test]
async fn the_agenda_range_includes_events_that_span_it() {
    let s = store().await;
    let mut trip = event("trip", "Reise", datetime!(2026-11-28 00:00));
    trip.all_day = true;
    trip.end = Some(datetime!(2026-12-03 00:00));
    s.upsert_event(&trip, None, 1).await.unwrap();
    s.upsert_event(&event("a", "Früh", datetime!(2026-11-02 09:00)), None, 1)
        .await
        .unwrap();
    s.upsert_event(&event("b", "Mitte", datetime!(2026-12-01 09:00)), None, 1)
        .await
        .unwrap();
    s.upsert_event(&event("c", "Spät", datetime!(2026-12-20 09:00)), None, 1)
        .await
        .unwrap();
    let titles = |v: Vec<StoredEvent>| v.into_iter().map(|e| e.event.title).collect::<Vec<_>>();
    assert_eq!(
        titles(s.events("2026-12-01", "2026-12-02", false).await.unwrap()),
        ["Reise", "Mitte"]
    );
    assert_eq!(
        titles(s.events("2026-11-01", "2026-12-31", false).await.unwrap()),
        ["Früh", "Reise", "Mitte", "Spät"]
    );
    assert_eq!(
        titles(s.events("2026-12-03", "2026-12-03", false).await.unwrap()),
        ["Reise"]
    );
}

fn tpl(kind: TemplateKind, name: &str, text: &str, default: bool) -> Template {
    Template {
        id: 0,
        kind,
        name: name.into(),
        text: text.into(),
        fallback: None,
        audience: vec![],
        is_default: default,
    }
}

#[tokio::test]
async fn templates_round_trip_and_only_one_default_per_kind() {
    let s = store().await;
    let mut friend = tpl(
        TemplateKind::Greeting,
        "Freunde",
        "Lieber {first_name},",
        true,
    );
    friend.audience = vec!["max@y.de".into(), "@freunde.de".into()];
    friend.fallback = Some("Hallo,".into());
    let friend = s.create_template(&friend).await.unwrap();
    let formal = s
        .create_template(&tpl(
            TemplateKind::Greeting,
            "Förmlich",
            "Sehr geehrte Damen und Herren,",
            true,
        ))
        .await
        .unwrap();
    let closing = s
        .create_template(&tpl(
            TemplateKind::Closing,
            "VG",
            "VG\n{my_first_name}",
            true,
        ))
        .await
        .unwrap();
    let all = s.templates().await.unwrap();
    assert_eq!(all.len(), 3);
    let by_id = |id| all.iter().find(|t| t.id == id).unwrap();
    assert!(
        !by_id(friend.id).is_default,
        "the later default replaced the earlier one"
    );
    assert!(by_id(formal.id).is_default);
    assert!(
        by_id(closing.id).is_default,
        "another kind keeps its default"
    );
    assert_eq!(by_id(friend.id).audience, ["max@y.de", "@freunde.de"]);
    assert_eq!(by_id(friend.id).fallback.as_deref(), Some("Hallo,"));

    let mut changed = by_id(friend.id).clone();
    changed.is_default = true;
    changed.name = "Gute Freunde".into();
    assert!(s.update_template(&changed).await.unwrap());
    let all = s.templates().await.unwrap();
    assert!(all.iter().find(|t| t.id == friend.id).unwrap().is_default);
    assert!(!all.iter().find(|t| t.id == formal.id).unwrap().is_default);
    assert!(s.delete_template(closing.id).await.unwrap());
    assert!(!s.delete_template(closing.id).await.unwrap());
    assert_eq!(s.templates().await.unwrap().len(), 2);
}

#[tokio::test]
async fn settings_are_overwritten() {
    let s = store().await;
    assert_eq!(s.get_setting("k").await.unwrap(), None);
    s.set_setting("k", "1").await.unwrap();
    s.set_setting("k", "2").await.unwrap();
    assert_eq!(s.get_setting("k").await.unwrap().as_deref(), Some("2"));
}

#[tokio::test]
async fn migrations_run_twice_without_harm() {
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}?mode=rwc", dir.path().join("mail.db").display());
    let first = MailStore::connect(&url).await.unwrap();
    first.set_setting("k", "v").await.unwrap();
    drop(first);
    let again = MailStore::connect(&url).await.unwrap();
    assert_eq!(again.get_setting("k").await.unwrap().as_deref(), Some("v"));
}

#[tokio::test]
async fn postgres_when_available() {
    let Ok(url) = std::env::var("FINANCER_TEST_POSTGRES_URL") else {
        return;
    };
    let s = MailStore::connect(&url).await.unwrap();
    let id = format!("pg-{}@x", std::process::id());
    let m = msg(&id, "Postgres", "max@y.de", 100);
    let first = s.insert_message(&m, 1).await.unwrap();
    assert!(first.is_some() || s.message_by_message_id(&id).await.unwrap().is_some());
    assert_eq!(s.insert_message(&m, 1).await.unwrap(), None);
    assert!(!s.metas(5).await.unwrap().is_empty());
}

#[tokio::test]
async fn events_can_be_listed_by_the_message_they_came_from() {
    let s = store().await;
    s.upsert_event(
        &event("a", "Eins", datetime!(2026-11-05 14:00)),
        Some(10),
        1,
    )
    .await
    .unwrap();
    s.upsert_event(
        &event("b", "Zwei", datetime!(2026-11-06 14:00)),
        Some(11),
        1,
    )
    .await
    .unwrap();
    s.upsert_event(&event("c", "Drei", datetime!(2026-11-07 14:00)), None, 1)
        .await
        .unwrap();
    let got = s.events_of_messages(&[10, 12]).await.unwrap();
    assert_eq!(
        got.iter()
            .map(|e| e.event.title.as_str())
            .collect::<Vec<_>>(),
        ["Eins"]
    );
    let id = got[0].id;
    s.set_event_status(id, EventStatus::Dismissed, 2)
        .await
        .unwrap();
    assert!(s.events_of_messages(&[10]).await.unwrap().is_empty());
}
