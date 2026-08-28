// Scratch harness: read "CODE<TAB>BRAILLE" lines on stdin, print MathML (or an
// error) per line. Used to score MathCAT's in-development back-translator
// against the same corpora as our own converters.
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line { Ok(l) => l, Err(_) => break };
        let mut parts = line.splitn(2, '\t');
        let code = parts.next().unwrap_or("Nemeth");
        let brl = parts.next().unwrap_or("");
        let res = libmathcat::back_translate::braille_to_mathml_str(brl, code);
        match res {
            Ok(mathml) => { let _ = writeln!(out, "OK\t{}", mathml.replace('\n', " ")); }
            Err(e) => { let _ = writeln!(out, "ERR\t{}", e.to_string().replace('\n', " ")); }
        }
    }
}
