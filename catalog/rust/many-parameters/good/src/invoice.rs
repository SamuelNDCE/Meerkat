pub struct InvoiceInput<'a> {
    pub id: u32,
    pub name: &'a str,
    pub street: &'a str,
    pub city: &'a str,
    pub zip: &'a str,
    pub country: &'a str,
    pub note: &'a str,
}

pub fn invoice(i: &InvoiceInput) -> String {
    format!("{} {} {} {} {} {} {}", i.id, i.name, i.street, i.city, i.zip, i.country, i.note)
}
