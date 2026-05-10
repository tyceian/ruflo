use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Verb {
    Help,
    Cls,
    Exit,
    List,
    Desc,
    Chart,
    Watch,
    Unwatch,
    Ask,
    Crypto,
    News,
    Macro,
    Yields,
    Fx,
    Options,
    Insider,
    Financials,
    Risk,
    Corpact,
    Inbox,
    Export,
}

impl Verb {
    pub fn from_token(s: &str) -> Option<Self> {
        // Match without allocating: ASCII case-insensitive comparisons against
        // each alias string. Called once per parsed token.
        let eq = |alias: &str| s.eq_ignore_ascii_case(alias);
        if eq("HELP") || s == "?" {
            Some(Verb::Help)
        } else if eq("CLS") || eq("CLEAR") {
            Some(Verb::Cls)
        } else if eq("EXIT") || eq("QUIT") {
            Some(Verb::Exit)
        } else if eq("LIST") || eq("LS") {
            Some(Verb::List)
        } else if eq("DESC") || eq("DES") {
            Some(Verb::Desc)
        } else if eq("CHART") || eq("GP") || eq("GIP") {
            Some(Verb::Chart)
        } else if eq("WATCH") {
            Some(Verb::Watch)
        } else if eq("UNWATCH") {
            Some(Verb::Unwatch)
        } else if eq("ASK") {
            Some(Verb::Ask)
        } else if eq("CRYPTO") {
            Some(Verb::Crypto)
        } else if eq("NEWS") {
            Some(Verb::News)
        } else if eq("MACRO") {
            Some(Verb::Macro)
        } else if eq("YIELDS") {
            Some(Verb::Yields)
        } else if eq("FX") {
            Some(Verb::Fx)
        } else if eq("OPTIONS") {
            Some(Verb::Options)
        } else if eq("INSIDER") {
            Some(Verb::Insider)
        } else if eq("FINANCIALS") {
            Some(Verb::Financials)
        } else if eq("RISK") {
            Some(Verb::Risk)
        } else if eq("CORPACT") {
            Some(Verb::Corpact)
        } else if eq("INBOX") {
            Some(Verb::Inbox)
        } else if eq("EXPORT") {
            Some(Verb::Export)
        } else {
            None
        }
    }

    pub fn requires_symbol(self) -> bool {
        matches!(
            self,
            Verb::Desc
                | Verb::Chart
                | Verb::Watch
                | Verb::Unwatch
                | Verb::Crypto
                | Verb::Options
                | Verb::Insider
                | Verb::Financials
                | Verb::Corpact
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Arg {
    /// A bareword token, e.g. `6M`.
    Word(String),
    /// A double-quoted string body (without the surrounding quotes).
    Quoted(String),
}

impl Arg {
    pub fn as_str(&self) -> &str {
        match self {
            Arg::Word(s) | Arg::Quoted(s) => s,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Command {
    /// `None` for bare verbs (HELP, CLS, EXIT, LIST, ASK).
    pub symbol: Option<String>,
    pub verb: Verb,
    pub args: Vec<Arg>,
    /// Whether the user terminated the input with the `GO` sentinel.
    #[serde(default)]
    pub go: bool,
}
