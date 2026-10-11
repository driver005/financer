/// The UniFFI binding generator, built with the `bindgen-cli` feature.
struct UniffiBindgen;

impl UniffiBindgen {
    fn run() {
        uniffi::uniffi_bindgen_main()
    }
}

fn main() {
    UniffiBindgen::run()
}
