//! Every key of `financer.toml`, described once: where it sits, what it is called in the app, what
//! kind of value it holds, which environment variable overrides it and what to tell the person who
//! edits it. The settings screen of the app is drawn from this list, so a key that is described
//! here can be set from the app, and a test makes sure no key of the file is missing from it.

/// What kind of value a key holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Free text.
    Text,
    /// A path on the server.
    Path,
    /// Text that is never shown again once saved (keys, passwords, tokens).
    Secret,
    /// A whole number between `min` and `max`.
    Int,
    Bool,
    /// One of `options`.
    Choice,
    /// A list of texts.
    List,
    /// A list of rows, each with the `fields` of the key.
    Table,
}

impl Kind {
    pub const fn name(self) -> &'static str {
        match self {
            Kind::Text => "text",
            Kind::Path => "path",
            Kind::Secret => "secret",
            Kind::Int => "number",
            Kind::Bool => "toggle",
            Kind::Choice => "choice",
            Kind::List => "list",
            Kind::Table => "table",
        }
    }
}

/// One column of a [`Kind::Table`] key (a row of `[[bank.accounts]]`, say).
#[derive(Debug, Clone, Copy)]
pub struct Field {
    pub key: &'static str,
    pub label: &'static str,
    pub help: &'static str,
    /// Never [`Kind::Table`].
    pub kind: Kind,
    pub options: &'static [&'static str],
    pub min: i64,
    pub max: i64,
    pub required: bool,
    pub default: &'static str,
    pub placeholder: &'static str,
    /// Only meaningful while another field of the row has one of these values, written as a
    /// comma-separated list (a FinTS field of a Plaid account does nothing). The app hides the
    /// field otherwise.
    pub when: Option<(&'static str, &'static str)>,
    /// A [`Kind::List`] whose entries are written `left=right` in the app and stored as objects
    /// `{ left: .., right: .. }` (the items of an Open Prices source).
    pub pair: Option<(&'static str, &'static str)>,
}

impl Field {
    pub const fn new(key: &'static str, label: &'static str, kind: Kind) -> Self {
        Self {
            key,
            label,
            help: "",
            kind,
            options: &[],
            min: 0,
            max: i64::MAX,
            required: false,
            default: "",
            placeholder: "",
            when: None,
            pair: None,
        }
    }
    pub const fn help(mut self, v: &'static str) -> Self {
        self.help = v;
        self
    }
    pub const fn options(mut self, v: &'static [&'static str]) -> Self {
        self.options = v;
        self
    }
    pub const fn range(mut self, min: i64, max: i64) -> Self {
        self.min = min;
        self.max = max;
        self
    }
    pub const fn pair(mut self, left: &'static str, right: &'static str) -> Self {
        self.pair = Some((left, right));
        self
    }
    pub const fn required(mut self) -> Self {
        self.required = true;
        self
    }
    pub const fn default(mut self, v: &'static str) -> Self {
        self.default = v;
        self
    }
    pub const fn placeholder(mut self, v: &'static str) -> Self {
        self.placeholder = v;
        self
    }
    /// Applies only while `field` has one of `values` (comma-separated).
    pub const fn when(mut self, field: &'static str, values: &'static str) -> Self {
        self.when = Some((field, values));
        self
    }

    /// Whether the column applies to a row whose `field` has `actual`.
    pub fn applies_to(&self, actual: &str) -> bool {
        match self.when {
            None => true,
            Some((_, values)) => values.split(',').any(|v| v.trim() == actual),
        }
    }
}

/// One key of the file.
#[derive(Debug, Clone, Copy)]
pub struct Key {
    /// Dotted path as in the file: `llm.anthropic_api_key`, `bank.accounts`.
    pub path: &'static str,
    /// The [`Group`] it is shown in.
    pub group: &'static str,
    pub label: &'static str,
    pub help: &'static str,
    pub kind: Kind,
    pub options: &'static [&'static str],
    pub min: i64,
    pub max: i64,
    /// What applies when nothing is set, for display.
    pub default: &'static str,
    pub placeholder: &'static str,
    /// The environment variable that overrides this key. While it is set, the app cannot change
    /// the key.
    pub env: Option<&'static str>,
    /// Said before saving, for keys that can make the server unreachable or point it elsewhere.
    pub warning: Option<&'static str>,
    pub fields: &'static [Field],
}

impl Key {
    pub const fn new(
        path: &'static str,
        group: &'static str,
        label: &'static str,
        kind: Kind,
    ) -> Self {
        Self {
            path,
            group,
            label,
            help: "",
            kind,
            options: &[],
            min: 0,
            max: i64::MAX,
            default: "",
            placeholder: "",
            env: None,
            warning: None,
            fields: &[],
        }
    }
    pub const fn help(mut self, v: &'static str) -> Self {
        self.help = v;
        self
    }
    pub const fn options(mut self, v: &'static [&'static str]) -> Self {
        self.options = v;
        self
    }
    pub const fn range(mut self, min: i64, max: i64) -> Self {
        self.min = min;
        self.max = max;
        self
    }
    pub const fn default(mut self, v: &'static str) -> Self {
        self.default = v;
        self
    }
    pub const fn placeholder(mut self, v: &'static str) -> Self {
        self.placeholder = v;
        self
    }
    pub const fn env(mut self, v: &'static str) -> Self {
        self.env = Some(v);
        self
    }
    pub const fn warning(mut self, v: &'static str) -> Self {
        self.warning = Some(v);
        self
    }
    pub const fn fields(mut self, v: &'static [Field]) -> Self {
        self.fields = v;
        self
    }

    /// The column called `name` of a table key.
    pub fn field(&self, name: &str) -> Option<&'static Field> {
        self.fields.iter().find(|f| f.key == name)
    }
}

/// A heading of the settings screen with the keys that belong under it.
#[derive(Debug, Clone, Copy)]
pub struct Group {
    pub id: &'static str,
    pub title: &'static str,
    pub hint: &'static str,
    /// A name from the app's icon set.
    pub icon: &'static str,
}

pub const GROUPS: &[Group] = &[
    Group {
        id: "server",
        title: "Server",
        hint: "Where the server listens and what it serves.",
        icon: "server-network",
    },
    Group {
        id: "access",
        title: "Access token",
        hint: "The token this app sends with every request.",
        icon: "key-outline",
    },
    Group {
        id: "database",
        title: "Database",
        hint: "Where your data is stored.",
        icon: "database-outline",
    },
    Group {
        id: "prices",
        title: "Prices",
        hint: "Which shops are asked for prices, and how often.",
        icon: "tag-multiple-outline",
    },
    Group {
        id: "ai",
        title: "AI",
        hint: "Keys for recipe ideas, receipt photos and category suggestions.",
        icon: "creation-outline",
    },
    Group {
        id: "bank",
        title: "Bank providers",
        hint: "FinTS and Plaid, the two ways to connect a bank.",
        icon: "bank-outline",
    },
    Group {
        id: "accounts",
        title: "Bank accounts",
        hint: "The accounts that sync automatically.",
        icon: "bank-transfer",
    },
    Group {
        id: "stores",
        title: "Store names",
        hint: "Bank texts that belong to a supermarket chain.",
        icon: "store-outline",
    },
    Group {
        id: "email",
        title: "Receipts: mailbox",
        hint: "Read receipt mails over IMAP.",
        icon: "email-sync-outline",
    },
    Group {
        id: "lidl",
        title: "Receipts: Lidl Plus",
        hint: "Experimental and unofficial.",
        icon: "receipt-text-outline",
    },
    Group {
        id: "folder",
        title: "Receipts: watched folder",
        hint: "Receipts dropped into a folder on the server.",
        icon: "folder-download-outline",
    },
];

const ACCOUNT_FIELDS: &[Field] = &[
    Field::new("name", "Name", Kind::Text)
        .required()
        .help("Shown in the app. Must be unique.")
        .placeholder("Girokonto"),
    Field::new("kind", "Provider", Kind::Choice)
        .options(&["fints", "plaid"])
        .default("fints")
        .help("FinTS talks to your bank directly (PIN and an approval in the banking app); Plaid has you sign in once on its page."),
    Field::new("bank_code", "Bank code", Kind::Text)
        .required()
        .help("The 8-digit bank code (BLZ).")
        .placeholder("37050198")
        .when("kind", "fints"),
    Field::new("login", "Login name", Kind::Text)
        .required()
        .help("Your online banking login name.")
        .when("kind", "fints"),
    Field::new("iban", "IBAN", Kind::Text)
        .required()
        .help("The account to read. FinTS needs it to pick the account.")
        .placeholder("DE89 3704 0044 0532 0130 00")
        .when("kind", "fints"),
    Field::new("fints_url", "FinTS address", Kind::Text)
        .help("Only for a bank that is not in the built-in list; then the BIC is needed too.")
        .placeholder("https://banking.example/fints")
        .when("kind", "fints"),
    Field::new("bic", "BIC", Kind::Text)
        .help("Only together with the FinTS address.")
        .placeholder("COBADEFFXXX")
        .when("kind", "fints"),
    Field::new("pin_env", "PIN variable", Kind::Text)
        .help("The NAME of an environment variable on the server that holds the PIN. The PIN itself is never stored: without a variable you type it in the app for each sync.")
        .placeholder("SPARKASSE_PIN")
        .when("kind", "fints"),
    Field::new("account_ids", "Accounts to read", Kind::List)
        .help("Optional: read only these accounts (the ids the app shows once the bank is linked). Leave empty to read every linked account.")
        .when("kind", "plaid"),
    Field::new("sync_every_hours", "Sync every (hours)", Kind::Int)
        .range(0, 24 * 366)
        .default("0")
        .help("0 means only when you press Sync now."),
    Field::new("since_days", "First import reaches back (days)", Kind::Int)
        .range(1, 365)
        .default("90")
        .help("Banks often allow about 90 days."),
];

const STORE_FIELDS: &[Field] = &[
    Field::new("chain", "Chain", Kind::Text)
        .required()
        .help("A built-in chain (rewe, lidl, aldi, ...) or a name of your own.")
        .placeholder("edeka"),
    Field::new("match", "Bank texts", Kind::List)
        .required()
        .help("Text that appears in the booking's counterparty or purpose. Case and punctuation do not matter; at least 3 letters each."),
];

const PRICE_SOURCE_FIELDS: &[Field] = &[
    Field::new("type", "Kind of source", Kind::Choice)
        .options(&["json_ld", "llm_page", "open_prices"])
        .default("json_ld")
        .help("json_ld reads products embedded in a page (schema.org); llm_page has your AI model read a page's text (costs API calls); open_prices uses crowdsourced shelf prices for barcodes."),
    Field::new("chain", "Shop", Kind::Choice)
        .options(&["rewe", "lidl", "aldi", "kaufland"])
        .default("rewe")
        .help("Whose prices the pages show.")
        .when("type", "json_ld,llm_page"),
    Field::new("urls", "Pages", Kind::List)
        .required()
        .help("Offer or product pages to read. Only pages the shop's robots.txt allows are fetched.")
        .placeholder("https://www.example.com/angebote")
        .when("type", "json_ld,llm_page"),
    Field::new("is_offer", "These are offers", Kind::Bool)
        .help("The prices on these pages are limited-time offers, not the everyday price.")
        .when("type", "json_ld,llm_page"),
    Field::new("items", "Items", Kind::List)
        .required()
        .pair("item", "barcode")
        .help("One per entry as item=barcode, for example milch=4012345678901. The item is a key from the catalog; the barcode is the EAN of a product you buy.")
        .placeholder("milch=4012345678901")
        .when("type", "open_prices"),
    Field::new("max_age_days", "Ignore prices older than (days)", Kind::Int)
        .range(1, 365)
        .default("60")
        .when("type", "open_prices"),
];

const SENDER_FIELDS: &[Field] = &[
    Field::new("retailer", "Shop", Kind::Text)
        .default("auto")
        .help("rewe, lidl, edeka, ... or auto to read the shop from the receipt itself."),
    Field::new("from", "From", Kind::List)
        .required()
        .help("Domains (rewe.de also matches its subdomains) or exact addresses."),
    Field::new("subject_contains", "Subject contains", Kind::List)
        .help("When not empty, the subject must contain one of these."),
];

/// Every key, in the order the app shows them.
pub const KEYS: &[Key] = &[
    // -------------------------------------------------------------------------------- server
    Key::new("server.bind", "server", "Listen address", Kind::Text)
        .help("Address and port to listen on. Use 0.0.0.0:8080 behind a reverse proxy or in Docker, and never expose it without HTTPS.")
        .env("FINANCER_BIND")
        .default("127.0.0.1:8080")
        .placeholder("0.0.0.0:8080")
        .warning("The app reaches the server at its current address. If you change the port or the address, this app may not find the server again until you change the address in Settings > Backend."),
    Key::new("server.web_dir", "server", "Web app folder", Kind::Path)
        .help("Folder of the built web app (expo export --platform web) to serve at /. Needs an index.html.")
        .env("FINANCER_WEB_DIR")
        .placeholder("/srv/web"),
    Key::new("server.cors_origins", "server", "Allowed web origins", Kind::List)
        .help("Development only: browsers on these origins may call the API (the hot-reloading web app). Leave empty in production.")
        .env("FINANCER_CORS_ORIGIN")
        .placeholder("http://localhost:8081"),
    // -------------------------------------------------------------------------------- access
    Key::new("auth.api_token", "access", "API token", Kind::Secret)
        .help("At least 32 characters; `openssl rand -hex 32` makes a good one. Use this or the token file, not both.")
        .env("FINANCER_API_TOKEN")
        .warning("The app must send the new token afterwards. This app switches to the new one by itself once the server is back; other devices need it entered again."),
    Key::new("auth.api_token_file", "access", "API token file", Kind::Path)
        .help("Read the token from a file instead (a Docker secret, say). Use this or the token, not both.")
        .placeholder("/run/secrets/financer_token")
        .warning("The app must send the token from the new file afterwards."),
    // -------------------------------------------------------------------------------- database
    Key::new("database.url", "database", "Database address", Kind::Secret)
        .help("sqlite://path?mode=rwc or postgres://user:password@host/db.")
        .env("FINANCER_DATABASE_URL")
        .default("sqlite://financer.db?mode=rwc")
        .warning("This points the server at another database. Your current data stays where it is and is not copied; the server starts with whatever the new database holds."),
    // -------------------------------------------------------------------------------- prices
    Key::new("prices.sources_file", "prices", "Price sources file", Kind::Path)
        .help("JSON file listing the price sources (see docs/PRICES.md). Default: no sources.")
        .env("FINANCER_PRICE_SOURCES")
        .placeholder("sources.json"),
    Key::new("prices.sources", "prices", "Price sources", Kind::Table)
        .help("Where prices come from, written here instead of in a JSON file. Used together with the sources file above. See docs/PRICES.md.")
        .fields(PRICE_SOURCE_FIELDS),
    Key::new("server.refresh_hours", "prices", "Refresh prices every (hours)", Kind::Int)
        .help("Hours between automatic price refreshes, 0 = off.")
        .env("FINANCER_REFRESH_HOURS")
        .default("24")
        .range(0, 24 * 366),
    // -------------------------------------------------------------------------------- ai
    Key::new("llm.anthropic_api_key", "ai", "Claude (Anthropic) API key", Kind::Secret)
        .help("Enables recipe ideas, receipt photos and category suggestions with Claude.")
        .env("FINANCER_ANTHROPIC_API_KEY"),
    Key::new("llm.openai_api_key", "ai", "OpenAI API key", Kind::Secret)
        .help("Enables the same with OpenAI.")
        .env("FINANCER_OPENAI_API_KEY"),
    Key::new("llm.provider", "ai", "Provider until you pick one", Kind::Choice)
        .help("Which provider to use until you choose one in the app.")
        .options(&["claude", "openai"])
        .env("FINANCER_LLM_PROVIDER")
        .default("claude"),
    // -------------------------------------------------------------------------------- bank
    Key::new("bank.fints_product_id", "bank", "FinTS product id", Kind::Secret)
        .help("Your FinTS product id from the Deutsche Kreditwirtschaft (see docs/FINTS.md). Without it live bank sync through FinTS stays off.")
        .env("FINANCER_FINTS_PRODUCT_ID"),
    Key::new("bank.plaid.client_id", "bank", "Plaid client id", Kind::Secret)
        .help("From your Plaid dashboard (dashboard.plaid.com). Turn on Hosted Link for these keys.")
        .env("FINANCER_PLAID_CLIENT_ID"),
    Key::new("bank.plaid.secret", "bank", "Plaid secret", Kind::Secret)
        .help("The secret that belongs to the client id, for the environment chosen below.")
        .env("FINANCER_PLAID_SECRET"),
    Key::new("bank.plaid.environment", "bank", "Plaid environment", Kind::Choice)
        .help("sandbox is Plaid's test bank (user_good / pass_good); production is for your real bank.")
        .options(&["sandbox", "production"])
        .env("FINANCER_PLAID_ENV")
        .default("sandbox"),
    Key::new("bank.plaid.country_codes", "bank", "Plaid countries", Kind::List)
        .help("Countries whose banks you can pick in Plaid's window, as two-letter codes.")
        .default("DE")
        .placeholder("DE"),
    Key::new("bank.plaid.language", "bank", "Plaid language", Kind::Text)
        .help("Language of Plaid's window, as a two-letter code.")
        .default("de")
        .placeholder("de"),
    Key::new("bank.plaid.redirect_uri", "bank", "Plaid return address", Kind::Text)
        .help("Where Plaid's page sends the browser when you are done (https only). Optional; without it the page just says you can close it.")
        .placeholder("https://example.org/done"),
    // -------------------------------------------------------------------------------- accounts
    Key::new("bank.accounts", "accounts", "Accounts", Kind::Table)
        .help("One entry per account to sync automatically. A FinTS sync always needs your approval in the banking app; a Plaid account needs neither PIN nor approval once you have signed in.")
        .fields(ACCOUNT_FIELDS),
    // -------------------------------------------------------------------------------- stores
    Key::new("stores", "stores", "Store names", Kind::Table)
        .help("Your own spellings for the spending-per-supermarket report, added to the built-in list (Lidl, Aldi, Kaufland, Rewe, Edeka and more), or a local store as a new chain.")
        .fields(STORE_FIELDS),
    // -------------------------------------------------------------------------------- email
    Key::new("receipts.email.enabled", "email", "Read the mailbox", Kind::Bool)
        .help("Switch the source off without deleting its settings.")
        .env("FINANCER_RECEIPTS_IMAP_ENABLED")
        .default("on"),
    Key::new("receipts.email.host", "email", "IMAP server", Kind::Text)
        .help("Over IMAP with TLS. Needs the user name too.")
        .env("FINANCER_RECEIPTS_IMAP_HOST")
        .placeholder("imap.example.org"),
    Key::new("receipts.email.port", "email", "Port", Kind::Int)
        .env("FINANCER_RECEIPTS_IMAP_PORT")
        .default("993")
        .range(1, 65535),
    Key::new("receipts.email.username", "email", "User name", Kind::Text)
        .env("FINANCER_RECEIPTS_IMAP_USERNAME")
        .placeholder("you@example.org"),
    Key::new("receipts.email.password", "email", "Password", Kind::Secret)
        .help("Kept in the server's settings file, readable by the server's user only. Or leave it empty and name an environment variable below."),
    Key::new("receipts.email.password_env", "email", "Password variable", Kind::Text)
        .help("The NAME of the environment variable that holds the password (used when no password is entered above).")
        .env("FINANCER_RECEIPTS_IMAP_PASSWORD_ENV")
        .default("FINANCER_IMAP_PASSWORD"),
    Key::new("receipts.email.folder", "email", "Mailbox folder", Kind::Text)
        .env("FINANCER_RECEIPTS_IMAP_FOLDER")
        .default("INBOX"),
    Key::new("receipts.email.poll_minutes", "email", "Check every (minutes)", Kind::Int)
        .env("FINANCER_RECEIPTS_IMAP_POLL_MINUTES")
        .default("30")
        .range(1, 24 * 60),
    Key::new("receipts.email.mark_seen", "email", "Mark processed mails as read", Kind::Bool)
        .help("Needs write access to the mailbox. Off: the mailbox is only read.")
        .env("FINANCER_RECEIPTS_IMAP_MARK_SEEN")
        .default("off"),
    Key::new("receipts.email.max_age_days", "email", "First run looks back (days)", Kind::Int)
        .help("On the first run, only look at mails this new.")
        .env("FINANCER_RECEIPTS_IMAP_MAX_AGE_DAYS")
        .default("90")
        .range(1, 3650),
    Key::new("receipts.email.senders", "email", "Receipt senders", Kind::Table)
        .help("Which senders are receipt mails. Leave empty to use the built-in German retailers (rewe.de, lidl.de, kaufland.de, edeka.de, dm.de, rossmann.de, penny.de, netto-online.de).")
        .env("FINANCER_RECEIPTS_IMAP_SENDERS")
        .fields(SENDER_FIELDS),
    // -------------------------------------------------------------------------------- lidl
    Key::new("receipts.lidl_plus.enabled", "lidl", "Lidl Plus", Kind::Bool)
        .help("Experimental and unofficial: it may stop working whenever Lidl changes something. You sign in on Lidl's own page from Settings > Receipt sources; only a refresh token is kept, encrypted.")
        .env("FINANCER_RECEIPTS_LIDL_PLUS")
        .default("off"),
    Key::new("receipts.lidl_plus.country", "lidl", "Country", Kind::Text)
        .help("Two-letter country code of your Lidl Plus account.")
        .env("FINANCER_RECEIPTS_LIDL_COUNTRY")
        .default("DE"),
    Key::new("receipts.lidl_plus.language", "lidl", "Language", Kind::Text)
        .help("Two-letter language code.")
        .env("FINANCER_RECEIPTS_LIDL_LANGUAGE")
        .default("de"),
    Key::new("receipts.lidl_plus.poll_hours", "lidl", "Check every (hours)", Kind::Int)
        .env("FINANCER_RECEIPTS_LIDL_POLL_HOURS")
        .default("12")
        .range(1, 24 * 14),
    Key::new("receipts.lidl_plus.client_id", "lidl", "Client id override", Kind::Text)
        .help("Only if Lidl changes the built-in value."),
    Key::new("receipts.lidl_plus.authorize_url", "lidl", "Sign-in address override", Kind::Text)
        .help("Only if Lidl changes the built-in value."),
    Key::new("receipts.lidl_plus.token_url", "lidl", "Token address override", Kind::Text)
        .help("Only if Lidl changes the built-in value."),
    Key::new("receipts.lidl_plus.tickets_url", "lidl", "Receipts address override", Kind::Text)
        .help("Only if Lidl changes the built-in value."),
    Key::new("receipts.lidl_plus.redirect_uri", "lidl", "Return address override", Kind::Text)
        .help("Only if Lidl changes the built-in value."),
    Key::new("receipts.lidl_plus.scope", "lidl", "Scope override", Kind::Text)
        .help("Only if Lidl changes the built-in value."),
    // -------------------------------------------------------------------------------- folder
    Key::new("receipts.folder.enabled", "folder", "Watch the folder", Kind::Bool)
        .help("Switch the source off without deleting its settings.")
        .default("on"),
    Key::new("receipts.folder.path", "folder", "Folder", Kind::Path)
        .help("PDF, text, HTML or .eml receipts dropped into this folder on the server are imported.")
        .env("FINANCER_RECEIPTS_FOLDER")
        .placeholder("/data/receipts"),
    Key::new("receipts.folder.poll_seconds", "folder", "Check every (seconds)", Kind::Int)
        .env("FINANCER_RECEIPTS_FOLDER_POLL_SECONDS")
        .default("60")
        .range(10, 24 * 3600),
    Key::new("receipts.folder.on_done", "folder", "After importing", Kind::Choice)
        .help("keep remembers files by content; move files them under done/.")
        .options(&["keep", "move"])
        .env("FINANCER_RECEIPTS_FOLDER_ON_DONE")
        .default("keep"),
];

/// The key with this dotted path.
pub fn key(path: &str) -> Option<&'static Key> {
    KEYS.iter().find(|k| k.path == path)
}
