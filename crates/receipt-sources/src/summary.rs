/// What one run of a source did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunSummary {
    /// New receipts stored.
    pub imported: u32,
    /// Receipts that were already stored.
    pub duplicates: u32,
    /// Mails, files or tickets that were looked at and are not receipts we can read.
    pub skipped: u32,
    /// Remarks for the user (at most a few), e.g. why a file was skipped.
    pub notes: Vec<String>,
}

impl RunSummary {
    const MAX_NOTES: usize = 5;

    pub fn note(&mut self, text: impl Into<String>) {
        if self.notes.len() < Self::MAX_NOTES {
            self.notes.push(text.into().chars().take(200).collect());
        }
    }
}
