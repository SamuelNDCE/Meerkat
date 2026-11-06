from dataclasses import asdict, dataclass


@dataclass
class InvoiceInput:
    id: str
    name: str
    street: str
    city: str
    zip_code: str
    country: str
    note: str


def invoice(data: InvoiceInput):
    return asdict(data)
