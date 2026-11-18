//! uiconv: converts the Medusa design system (React DOM) to the Expo design system in packages/ui.
//!
//! `uiconv classes <medusa ui/src> <constants>`: report which Tailwind classes map to tokens.
//! `uiconv icons <medusa icons/src> <out.ts>`: every SVG icon becomes a data record in a constants
//! file; one `MedusaIcon` component renders any of them with react-native-svg, at a token size.

mod classes;
mod icons;
mod tailwind;
mod tokens;

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["icons", src, out] => icons::run(src.as_ref(), out.as_ref()),
        ["classes", ui_src, constants] => classes::run(ui_src.as_ref(), constants.as_ref()),
        _ => Err("usage: uiconv icons <medusa icons/src> <out.ts> | uiconv classes <medusa ui/src> <packages/ui/src/constants>".to_string()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("uiconv: {e}");
            ExitCode::FAILURE
        }
    }
}
