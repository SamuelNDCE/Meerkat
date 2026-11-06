pub fn invoice(id: u32, name: &str, street: &str, city: &str, zip: &str, country: &str, note: &str) -> String {
    format!("{id} {name} {street} {city} {zip} {country} {note}")
}
