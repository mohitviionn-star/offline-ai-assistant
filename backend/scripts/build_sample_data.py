"""Build a sample SQLite DB and a sample PDF for demoing the assistant.
Run inside the backend container or with `python backend/scripts/build_sample_data.py`.
"""
import sqlite3
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import RectangleObject

ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE_DIR = ROOT / "sample_data"
SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = SAMPLE_DIR / "business.db"
PDF_PATH = SAMPLE_DIR / "tenant_handbook.pdf"


def build_sqlite() -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    c = sqlite3.connect(DB_PATH)
    c.executescript(
        """
        CREATE TABLE properties (
            id INTEGER PRIMARY KEY,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            type TEXT NOT NULL,
            monthly_rent INTEGER NOT NULL,
            bedrooms INTEGER NOT NULL
        );
        CREATE TABLE tenants (
            id INTEGER PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT
        );
        CREATE TABLE leases (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            property_id INTEGER NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            monthly_rent INTEGER NOT NULL,
            security_deposit INTEGER NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY(tenant_id) REFERENCES tenants(id),
            FOREIGN KEY(property_id) REFERENCES properties(id)
        );
        CREATE TABLE payments (
            id INTEGER PRIMARY KEY,
            lease_id INTEGER NOT NULL,
            paid_on TEXT NOT NULL,
            amount INTEGER NOT NULL,
            method TEXT NOT NULL,
            FOREIGN KEY(lease_id) REFERENCES leases(id)
        );
        """
    )

    c.executemany(
        "INSERT INTO properties (id,address,city,type,monthly_rent,bedrooms) VALUES (?,?,?,?,?,?)",
        [
            (1, "120 Maple Ave", "Austin", "single_family", 2400, 3),
            (2, "445 Oak St #2B", "Austin", "apartment", 1800, 2),
            (3, "78 Pine Ridge Dr", "Round Rock", "single_family", 2200, 3),
            (4, "9 Birch Ct", "Austin", "townhouse", 2750, 4),
            (5, "210 Cedar Ln #5", "Pflugerville", "apartment", 1500, 1),
        ],
    )

    c.executemany(
        "INSERT INTO tenants (id,full_name,email,phone) VALUES (?,?,?,?)",
        [
            (1, "Alicia Romero", "alicia.r@example.com", "512-555-0142"),
            (2, "Devon Patel", "devon.p@example.com", "512-555-0188"),
            (3, "Mei Chen", "mei.c@example.com", "512-555-0173"),
            (4, "Jordan Hayes", "jordan.h@example.com", "512-555-0119"),
            (5, "Sara Kowalski", "sara.k@example.com", "512-555-0156"),
        ],
    )

    c.executemany(
        "INSERT INTO leases (id,tenant_id,property_id,start_date,end_date,monthly_rent,security_deposit,status) VALUES (?,?,?,?,?,?,?,?)",
        [
            (1, 1, 1, "2025-09-01", "2026-08-31", 2400, 2400, "active"),
            (2, 2, 2, "2025-10-15", "2026-10-14", 1800, 1800, "active"),
            (3, 3, 3, "2024-09-01", "2025-08-31", 2150, 2150, "expired"),
            (4, 4, 4, "2025-11-01", "2026-10-31", 2750, 5500, "active"),
            (5, 5, 5, "2026-02-01", "2027-01-31", 1500, 1500, "active"),
        ],
    )

    c.executemany(
        "INSERT INTO payments (id,lease_id,paid_on,amount,method) VALUES (?,?,?,?,?)",
        [
            (1, 1, "2026-03-01", 2400, "ach"),
            (2, 1, "2026-04-01", 2400, "ach"),
            (3, 1, "2026-05-01", 2400, "ach"),
            (4, 2, "2026-03-15", 1800, "card"),
            (5, 2, "2026-04-15", 1800, "card"),
            (6, 2, "2026-05-15", 1800, "card"),
            (7, 4, "2026-03-01", 2750, "ach"),
            (8, 4, "2026-04-01", 2750, "ach"),
            (9, 4, "2026-05-01", 2750, "ach"),
            (10, 5, "2026-03-01", 1500, "ach"),
            (11, 5, "2026-04-01", 1500, "ach"),
            (12, 5, "2026-05-01", 1500, "ach"),
        ],
    )

    c.commit()
    c.close()
    print(f"wrote {DB_PATH}")


PAGES = [
    [
        "TENANT HANDBOOK — OAKWOOD PROPERTY MANAGEMENT",
        "Effective Date: January 1, 2026",
        "",
        "Section 1. Rent Payments",
        "Rent is due on the 1st of each month. A grace period of five (5) calendar days is provided.",
        "Payments received after the 5th incur a late fee equal to 5% of the monthly rent.",
        "Accepted payment methods are ACH bank transfer and credit/debit card.",
        "Cash payments are not accepted under any circumstances.",
    ],
    [
        "Section 2. Security Deposits",
        "Security deposits are equal to one (1) month of rent for one-year leases.",
        "For leases longer than 12 months, a security deposit equal to two (2) months of rent is required.",
        "Security deposits are returned within 30 days of lease termination, less any documented damages.",
        "An itemized statement of deductions will be provided with any returned deposit.",
        "",
        "Section 3. Maintenance Requests",
        "Routine maintenance requests should be submitted through the tenant portal.",
        "Emergency repairs (water, gas, electrical, heat in winter) must be reported via the 24-hour hotline.",
        "Response time for emergencies is under 4 hours; routine requests are addressed within 3 business days.",
    ],
    [
        "Section 4. Privacy and Records",
        "Tenant personal information is stored only as required for lease administration and legal compliance.",
        "Access to tenant records is restricted to authorized property management staff.",
        "Tenants may request a copy of their records by written request; response within 14 days.",
        "Records are retained for seven (7) years after lease termination, then securely destroyed.",
        "",
        "Section 5. Lease Termination",
        "Either party may terminate at the end of the lease term with 60 days written notice.",
        "Early termination by the tenant incurs a fee equal to two months of rent unless a qualified replacement tenant is found.",
        "Termination by the landlord for cause requires written notice and any cure period required by Texas law.",
    ],
    [
        "Section 6. Pets",
        "Pets are permitted with prior written approval and a non-refundable pet fee of $300 per pet.",
        "A maximum of two (2) pets per unit is allowed. Aggressive breeds, as defined by insurance, are prohibited.",
        "Tenants are responsible for any damage caused by their pets, in addition to the pet fee.",
        "",
        "Section 7. Disputes",
        "Disputes should first be addressed in writing with the property manager.",
        "Unresolved disputes may proceed to mediation in Travis County, Texas, before litigation.",
        "This handbook is incorporated by reference into each lease executed by Oakwood Property Management.",
    ],
]


def build_pdf() -> None:
    """Build a multi-page text PDF using reportlab-free pypdf hack via simple content streams."""
    # Use reportlab if available; else fall back to a minimal manual PDF
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.pdfgen import canvas
    except Exception:
        _build_pdf_minimal()
        return

    c = canvas.Canvas(str(PDF_PATH), pagesize=LETTER)
    width, height = LETTER
    for page_lines in PAGES:
        y = height - 72
        for line in page_lines:
            if line.startswith("TENANT HANDBOOK"):
                c.setFont("Helvetica-Bold", 14)
            elif line.startswith("Section"):
                c.setFont("Helvetica-Bold", 12)
            else:
                c.setFont("Helvetica", 10)
            c.drawString(72, y, line)
            y -= 16
        c.showPage()
    c.save()
    print(f"wrote {PDF_PATH}")


def _ascii_safe(s: str) -> str:
    return (
        s.replace("—", "-")
        .replace("–", "-")
        .replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
        .encode("ascii", "replace")
        .decode("ascii")
    )


def _build_pdf_minimal() -> None:
    """Minimal PDF generator (no reportlab) — produces a valid multi-page PDF with text."""
    objects: list[bytes] = []

    def add(obj: bytes) -> int:
        objects.append(obj)
        return len(objects)

    page_ids: list[int] = []
    content_ids: list[int] = []
    font_id = None

    # Reserve slots: 1=Catalog, 2=Pages, 3=Font, then pages + contents
    catalog_id = add(b"")
    pages_id = add(b"")
    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    for page_lines in PAGES:
        # Build content stream
        stream_lines = ["BT", "/F1 11 Tf", "1 0 0 1 72 720 Tm", "14 TL"]
        for i, line in enumerate(page_lines):
            text = _ascii_safe(line).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            if i == 0:
                stream_lines.append(f"({text}) Tj")
            else:
                stream_lines.append("T*")
                stream_lines.append(f"({text}) Tj")
        stream_lines.append("ET")
        stream = "\n".join(stream_lines).encode("latin-1")
        content_obj = b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
        cid = add(content_obj)
        content_ids.append(cid)

        page_obj = (
            b"<< /Type /Page /Parent " + str(pages_id).encode() + b" 0 R "
            b"/MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 " + str(font_id).encode() + b" 0 R >> >> "
            b"/Contents " + str(cid).encode() + b" 0 R >>"
        )
        pid = add(page_obj)
        page_ids.append(pid)

    kids = b" ".join(str(p).encode() + b" 0 R" for p in page_ids)
    objects[pages_id - 1] = (
        b"<< /Type /Pages /Count " + str(len(page_ids)).encode() + b" /Kids [" + kids + b"] >>"
    )
    objects[catalog_id - 1] = b"<< /Type /Catalog /Pages " + str(pages_id).encode() + b" 0 R >>"

    out = bytearray()
    out += b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += b"trailer\n"
    out += f"<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n".encode()
    out += f"startxref\n{xref_pos}\n%%EOF\n".encode()

    PDF_PATH.write_bytes(bytes(out))
    print(f"wrote {PDF_PATH} (minimal)")


if __name__ == "__main__":
    build_sqlite()
    build_pdf()
