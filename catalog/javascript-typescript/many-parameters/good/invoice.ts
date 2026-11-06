interface InvoiceInput {
  id: string
  name: string
  street: string
  city: string
  zip: string
  country: string
  note: string
}

export function invoice(input: InvoiceInput) {
  return { ...input }
}
