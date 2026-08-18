from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUTPUT_DIR = Path("docs/legal-review/2026-08-17")
REVIEW_DATE = "17 August 2026"
ENTITY = "ZERO ALPHA FITNESS LTD"
COMPANY_NUMBER = "15978998"
TRADING_NAME = "Zero Alpha Fitness"
ADDRESS = "Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE"
SUPPORT_EMAIL = "support@zeroalphafitness.co.uk"
SITE_URL = "https://alpha-wod.vercel.app/"

NAVY = "17324D"
BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
INK = "1E293B"
MUTED = "5F6B7A"
LIGHT_BLUE = "EAF2F8"
PALE_BLUE = "F4F8FC"
PALE_GREY = "F2F4F7"
BORDER = "C9D4DF"
RED = "A61B1B"
PALE_RED = "FDECEC"
AMBER = "8A4B08"
PALE_AMBER = "FFF4DF"
GREEN = "22633A"
WHITE = "FFFFFF"


@dataclass(frozen=True)
class DocSpec:
    filename: str
    title: str
    subtitle: str
    doc_id: str
    subject: str


SPECS = {
    "terms": DocSpec(
        "01-membership-terms-draft.docx",
        "Membership Terms",
        "Public membership purchase and ongoing membership",
        "ZAF-TERMS-DRAFT-2026-08-17-01",
        "Draft membership terms for public membership purchase",
    ),
    "privacy": DocSpec(
        "02-privacy-notice-draft.docx",
        "Privacy Notice",
        "Membership, payment, AlphaWOD and participant information",
        "ZAF-PRIVACY-DRAFT-2026-08-17-01",
        "Draft privacy notice for membership and AlphaWOD data",
    ),
    "cancel": DocSpec(
        "03-cancellation-refund-cooling-off-policy-draft.docx",
        "Cancellation, Refund and Cooling-off Policy",
        "Plain-English rules for rolling monthly memberships",
        "ZAF-CANCEL-DRAFT-2026-08-17-01",
        "Draft cancellation, refund and cooling-off policy",
    ),
    "adult": DocSpec(
        "04-adult-participant-waiver-draft.docx",
        "Adult Participant Waiver and Risk Acknowledgement",
        "For every participant aged 18 or over",
        "ZAF-ADULT-WAIVER-DRAFT-2026-08-17-01",
        "Draft adult participant waiver and risk acknowledgement",
    ),
    "guardian": DocSpec(
        "05-parent-guardian-addendum-draft.docx",
        "Parent/Guardian Consent and Youth Membership Addendum",
        "For Youngstars (ages 4–11) and Teenstars (ages 12–16)",
        "ZAF-GUARDIAN-DRAFT-2026-08-17-01",
        "Draft parent and guardian consent and youth membership addendum",
    ),
}


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, **edges) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        if edge not in edges:
            continue
        tag = "w:" + edge
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        for key, value in edges[edge].items():
            element.set(qn("w:" + key), str(value))


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def add_field(paragraph, instruction: str) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])


def add_hyperlink(paragraph, text: str, url: str) -> None:
    part = paragraph.part
    rel_id = part.relate_to(
        url,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), rel_id)
    run = OxmlElement("w:r")
    run_pr = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), BLUE)
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    run_pr.extend([color, underline])
    run.append(run_pr)
    node = OxmlElement("w:t")
    node.text = text
    run.append(node)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def set_link_style(run) -> None:
    run.font.color.rgb = RGBColor.from_string(BLUE)
    run.font.underline = True


def prevent_row_split(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def configure_document(doc: Document, spec: DocSpec) -> None:
    # Use one header/footer definition throughout. Separate odd/even definitions
    # render inconsistently in some LibreOffice versions and can push the even-
    # page footer fields outside the printable area.
    doc.settings.odd_and_even_pages_header_footer = False
    section = doc.sections[0]
    section.different_first_page_header_footer = False
    section.orientation = WD_ORIENT.PORTRAIT
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.82)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.9)
    section.right_margin = Inches(0.9)
    section.header_distance = Inches(0.36)
    section.footer_distance = Inches(0.35)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.1
    normal.paragraph_format.widow_control = True

    for style_name, size, color, before, after in (
        ("Title", 24, NAVY, 0, 4),
        ("Subtitle", 11.5, MUTED, 0, 12),
        ("Heading 1", 16, BLUE, 16, 7),
        ("Heading 2", 13, DARK_BLUE, 12, 5),
        ("Heading 3", 11.5, DARK_BLUE, 9, 4),
    ):
        style = styles[style_name]
        style.font.name = "Calibri"
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string(color)
        style.font.bold = style_name != "Subtitle"
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.widow_control = True

    for list_style in ("List Bullet", "List Number"):
        style = styles[list_style]
        style.font.name = "Calibri"
        style.font.size = Pt(10.5)
        style.font.color.rgb = RGBColor.from_string(INK)
        style.paragraph_format.left_indent = Inches(0.28)
        style.paragraph_format.first_line_indent = Inches(-0.18)
        style.paragraph_format.space_after = Pt(4)
        style.paragraph_format.line_spacing = 1.08
        style.paragraph_format.widow_control = True

    if "Small Print" not in styles:
        small = styles.add_style("Small Print", WD_STYLE_TYPE.PARAGRAPH)
    else:
        small = styles["Small Print"]
    small.font.name = "Calibri"
    small.font.size = Pt(8.5)
    small.font.color.rgb = RGBColor.from_string(MUTED)
    small.paragraph_format.space_after = Pt(3)
    small.paragraph_format.line_spacing = 1.0

    props = doc.core_properties
    props.title = spec.title
    props.subject = spec.subject
    props.author = ENTITY
    props.keywords = "draft, legal review, membership, Zero Alpha Fitness"
    props.comments = "Working draft for legal-owner and solicitor review; not approved for publication."
    props.created = datetime(2026, 8, 17, 9, 0, tzinfo=timezone.utc)
    props.modified = datetime(2026, 8, 17, 9, 0, tzinfo=timezone.utc)

    def format_header(header) -> None:
        header.is_linked_to_previous = False
        hp = header.paragraphs[0]
        hp.clear()
        hp.paragraph_format.space_after = Pt(0)

    def format_footer(footer) -> None:
        footer.is_linked_to_previous = False
        fp = footer.paragraphs[0]
        fp.clear()
        fp.alignment = WD_ALIGN_PARAGRAPH.LEFT
        fp.paragraph_format.space_before = Pt(0)
        fp.paragraph_format.space_after = Pt(0)
        left = fp.add_run(spec.doc_id)
        left.font.name = "Calibri"
        left.font.size = Pt(8)
        left.font.color.rgb = RGBColor.from_string(MUTED)
        tab_stops = fp.paragraph_format.tab_stops
        tab_stops.add_tab_stop(Inches(5.55))
        mid = fp.add_run("\tPage ")
        mid.font.size = Pt(8)
        mid.font.color.rgb = RGBColor.from_string(MUTED)
        add_field(fp, "PAGE")
        of_run = fp.add_run(" of ")
        of_run.font.size = Pt(8)
        of_run.font.color.rgb = RGBColor.from_string(MUTED)
        add_field(fp, "NUMPAGES")

    format_header(section.header)
    format_footer(section.footer)


def add_document_title(doc: Document, spec: DocSpec) -> None:
    p = doc.add_paragraph(style="Title")
    p.add_run(spec.title)
    p = doc.add_paragraph(style="Subtitle")
    p.add_run(spec.subtitle)

    table = doc.add_table(rows=2, cols=3)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    widths = [Inches(2.05), Inches(2.05), Inches(2.05)]
    labels = [
        ("STATUS", "Working draft"),
        ("VERSION DATE", REVIEW_DATE),
        ("DOCUMENT ID", spec.doc_id),
        ("CONTRACTING ENTITY", f"{ENTITY} · {COMPANY_NUMBER}"),
        ("TRADING NAME", TRADING_NAME),
        ("PUBLIC CONTACT", SUPPORT_EMAIL),
    ]
    for idx, cell in enumerate(table._cells):
        cell.width = widths[idx % 3]
        set_cell_shading(cell, PALE_GREY)
        set_cell_border(
            cell,
            top={"val": "single", "sz": "4", "color": WHITE},
            bottom={"val": "single", "sz": "4", "color": WHITE},
            left={"val": "single", "sz": "4", "color": WHITE},
            right={"val": "single", "sz": "4", "color": WHITE},
        )
        set_cell_margins(cell, 75, 100, 75, 100)
        label, value = labels[idx]
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(1)
        r = p.add_run(label + "\n")
        r.font.size = Pt(7.5)
        r.font.bold = True
        r.font.color.rgb = RGBColor.from_string(MUTED)
        r2 = p.add_run(value)
        r2.font.size = Pt(8.6)
        r2.font.color.rgb = RGBColor.from_string(INK)
    for row in table.rows:
        prevent_row_split(row)

    add_callout(
        doc,
        "DRAFT FOR LEGAL REVIEW — NOT APPROVED FOR PUBLICATION",
        "This working draft records the currently approved commercial and operational position. It must be reviewed by the business owner and a suitably qualified UK legal adviser before it is shown to customers or wired into checkout.",
        kind="danger",
    )


def add_callout(doc: Document, title: str, body: str, kind: str = "info") -> None:
    palette = {
        "info": (BLUE, LIGHT_BLUE),
        "warning": (AMBER, PALE_AMBER),
        "danger": (RED, PALE_RED),
        "success": (GREEN, "EAF6EE"),
    }
    color, fill = palette[kind]
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    cell = table.cell(0, 0)
    cell.width = Inches(6.55)
    set_cell_shading(cell, fill)
    set_cell_border(cell, left={"val": "single", "sz": "18", "color": color})
    set_cell_margins(cell, 110, 150, 105, 150)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(title.upper())
    r.bold = True
    r.font.size = Pt(9)
    r.font.color.rgb = RGBColor.from_string(color)
    p2 = cell.add_paragraph(body)
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.04
    for r2 in p2.runs:
        r2.font.size = Pt(9.5)
    prevent_row_split(table.rows[0])
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(1)
    after.paragraph_format.space_before = Pt(0)


def add_para(doc: Document, text: str, *, bold_lead: str | None = None, style: str | None = None):
    p = doc.add_paragraph(style=style)
    if bold_lead and text.startswith(bold_lead):
        r1 = p.add_run(bold_lead)
        r1.bold = True
        p.add_run(text[len(bold_lead):])
    else:
        p.add_run(text)
    return p


def add_bullets(doc: Document, items: Iterable[str]) -> None:
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.add_run(item)


def add_numbered(doc: Document, items: Iterable[str]) -> None:
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.add_run(item)


def add_quote(doc: Document, text: str) -> None:
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    cell = table.cell(0, 0)
    cell.width = Inches(6.45)
    set_cell_shading(cell, PALE_BLUE)
    set_cell_border(cell, left={"val": "single", "sz": "12", "color": BLUE})
    set_cell_margins(cell, 95, 140, 95, 140)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.05
    r = p.add_run(text)
    r.font.italic = True
    r.font.size = Pt(10)
    prevent_row_split(table.rows[0])
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(0)


def add_source_list(doc: Document, sources: Sequence[tuple[str, str]]) -> None:
    for label, url in sources:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.keep_together = True
        add_hyperlink(p, label, url)


def add_review_appendix(
    doc: Document,
    review_points: Sequence[str],
    sources: Sequence[tuple[str, str]],
    *,
    high_priority: str | None = None,
) -> None:
    doc.add_page_break()
    doc.add_heading("Legal review appendix", level=1)
    add_callout(
        doc,
        "Internal review material — remove before publication",
        "This appendix is not customer-facing contract text. It records unresolved legal and implementation checks for the owner and legal adviser.",
        kind="warning",
    )
    if high_priority:
        add_callout(doc, "High-priority review point", high_priority, kind="danger")
    doc.add_heading("Items to confirm", level=2)
    add_bullets(doc, review_points)
    doc.add_heading("Primary legal and regulatory sources", level=2)
    add_source_list(doc, sources)


def add_acceptance_block(doc: Document, heading: str, statements: Sequence[str], signer: str) -> None:
    doc.add_heading(heading, level=2)
    add_para(
        doc,
        "The checkout should show each required statement beside its own unticked control. Acceptance must be affirmative; do not pre-tick, infer or bundle optional marketing consent.",
    )
    for statement in statements:
        add_quote(doc, "☐ " + statement)
    add_para(
        doc,
        f"Evidence to retain: {signer}; the exact document version(s); the exact statement(s) displayed; typed name where required; UTC timestamp plus Europe/London display time; authenticated account or verified-email context; Stripe Checkout/subscription identifiers where relevant; and only the technical audit data disclosed in the Privacy Notice.",
    )


def build_terms() -> Path:
    spec = SPECS["terms"]
    doc = Document()
    configure_document(doc, spec)
    add_document_title(doc, spec)

    doc.add_heading("1. About these Terms", level=1)
    add_para(
        doc,
        f"These Membership Terms form the contract for a Zero Alpha Fitness membership purchased online from {ENTITY}, company number {COMPANY_NUMBER}, trading as {TRADING_NAME} (we, us or our). Our public trading and contact address is {ADDRESS}. Contact us at {SUPPORT_EMAIL}.",
    )
    add_para(
        doc,
        "The person who agrees to these Terms and pays for the membership is the payer. The person who takes part in training is the participant. They may be different adults. For a participant under 18, the payer must be their parent or legal guardian, or another adult with lawful authority to enter the arrangement for them.",
    )
    add_para(
        doc,
        "These Terms should be read with the Cancellation, Refund and Cooling-off Policy, the Privacy Notice, and the applicable Adult Participant Waiver or Parent/Guardian Consent and Youth Membership Addendum. Those documents are presented before purchase and form part of the membership arrangement where stated.",
    )

    doc.add_heading("2. Eligibility and who must accept what", level=1)
    add_bullets(
        doc,
        [
            "An adult participant must be aged 18 or over and must personally accept the Adult Participant Waiver and Risk Acknowledgement before taking part.",
            "A Youngstars participant must be aged 4 to 11 inclusive. A Teenstars participant must be aged 12 to 16 inclusive.",
            "A youth participant’s guardian must be the payer, confirm their relationship and authority, and accept the Parent/Guardian Consent and Youth Membership Addendum.",
            "Where the payer and adult participant differ, the payer accepts these Terms and the recurring-payment obligation; the participant separately accepts the waiver and receives the Privacy Notice.",
            "You must give accurate, complete and current information. You must not buy a youth membership for a child outside the stated age range or misrepresent authority to act for another person.",
        ],
    )

    doc.add_heading("3. Membership options and prices", level=1)
    add_para(doc, "The initial public catalogue is:")
    add_bullets(
        doc,
        [
            "Adult Unlimited Membership — £60 per month. This is the only paid membership that automatically includes eligible AlphaWOD access.",
            "Adult Ladies Only Membership — £50 per month.",
            "Adult Gym Only — £45 per month.",
            "Youth Membership — one catalogue card with Youngstars (ages 4–11) or Teenstars (ages 12–16), each £35 per month.",
        ],
    )
    add_para(
        doc,
        "There is no joining fee, free trial or minimum term. Each membership is a rolling monthly contract until cancelled under section 9. We are not currently VAT registered. The price displayed at checkout is the total customer price; no VAT invoice or VAT breakdown is offered. If our tax status changes, we will update the presentation and notices before applying any change.",
    )
    add_para(
        doc,
        "We may offer promotion codes subject to their stated eligibility, duration and limits. A promotion does not change the underlying rolling nature of the contract unless its terms expressly say so. A code has no cash value and cannot be applied retrospectively unless required by law or expressly agreed.",
    )

    doc.add_heading("4. How the contract is made", level=1)
    add_numbered(
        doc,
        [
            "Choose the membership and, for youth membership, the correct age option.",
            "Provide the required participant and payer or guardian details, review the documents, and complete each required acceptance or signature.",
            "Review the initial prorated charge, the full monthly price and the first full billing date shown by Stripe before submitting payment.",
            "Submit payment through Stripe Checkout. Available payment methods are those Stripe displays for that transaction and may vary by device, location, currency and eligibility.",
            "The contract is formed when payment is confirmed and we issue an on-screen or email confirmation, unless we promptly tell you that a clear pricing, eligibility or technical error prevented acceptance and refund any amount taken.",
        ],
    )
    add_para(
        doc,
        "The final payment control will use unambiguous wording such as ‘Subscribe and pay’. Before service begins, we will email a durable confirmation containing the agreed plan, amounts, next payment date, accepted document versions, cancellation information and signed acceptance evidence; a changeable website link alone is not the durable copy. For a youth membership, payment confirmation does not itself book a first session. We will contact the guardian by email to arrange onboarding and the first session.",
    )
    add_quote(
        doc,
        f"Payment confirmed. Zero Alpha Fitness will contact you by email to arrange onboarding and your first session. Questions: {SUPPORT_EMAIL}.",
    )

    doc.add_heading("5. Billing date, initial proration and recurring authority", level=1)
    add_para(
        doc,
        "All memberships use the first day of each calendar month as the regular billing date, interpreted in Europe/London time. If a membership starts after the first, Stripe calculates and displays an initial prorated charge for the period from the immediate start time until the next first of the month. That charge is payable immediately. The full monthly price is then charged on the next first and on each following first while the membership continues.",
    )
    add_para(
        doc,
        "The amount Stripe displays before payment is authoritative for that checkout. We do not calculate or round a separate proration in the browser. If the displayed initial charge or billing date appears wrong, do not pay; contact us first.",
    )
    add_para(
        doc,
        "By completing checkout, the payer authorises Stripe and us to store the selected payment method as permitted by that payment method and to collect the initial amount and future recurring amounts without the payer being present. The payer must keep the payment method valid and may update it through the secure Customer Portal.",
    )

    doc.add_heading("6. Price changes", level=1)
    add_para(
        doc,
        "We may change a recurring price only prospectively. We will give clear advance notice of the new amount and the date it would first apply, using the payer’s recorded email and any legally required method. The payer may cancel before the change takes effect. A price change will not alter amounts already paid or due for a completed billing event. Any legally required notice or cancellation right overrides this paragraph.",
    )

    doc.add_heading("7. What the membership provides", level=1)
    add_para(
        doc,
        "The selected membership provides access to the facilities, sessions or services described for that plan at the time of purchase, subject to opening hours, capacity, timetables, coaching instructions, reasonable safety rules and temporary closures. Membership is personal to the named participant and cannot be sold, shared or transferred without our written agreement.",
    )
    add_para(
        doc,
        "We may make reasonable operational changes to timetables, instructors, equipment, class formats or facilities. We will not use this clause to remove the essential benefit of the membership without a fair remedy. If a change is material and adverse, we will give reasonable notice where practicable and any cancellation or refund rights required by law.",
    )

    doc.add_heading("8. AlphaWOD access", level=1)
    add_bullets(
        doc,
        [
            "Paid Adult Unlimited Membership automatically qualifies the participant for AlphaWOD access while the subscription and payment status remain eligible.",
            "An existing AlphaWOD account holder should sign in and claim the purchase. Creating or paying for a duplicate active subscription may be blocked.",
            "Existing users whose AlphaWOD access was already approved before this purchase flow launches remain grandfathered unless their independent eligibility is later removed under a lawful policy.",
            "Administrators and SGPT staff may retain access through their role independently of a consumer membership.",
            "Youth memberships, Adult Ladies Only and Adult Gym Only do not automatically include AlphaWOD access.",
        ],
    )
    add_para(
        doc,
        "AlphaWOD access may be suspended or removed when the related entitlement is past due beyond the grace period, unpaid, fully refunded, subject to a lost payment dispute, cancelled or otherwise ineligible. A scheduled cancellation continues only through the paid access period. App availability also depends on compatible technology, internet service, security and maintenance.",
    )

    doc.add_heading("9. Ordinary cancellation of the rolling membership", level=1)
    add_callout(
        doc,
        "Prominent renewal rule",
        "To avoid the next first-of-month payment, a cancellation request must reach us at least 14 calendar days before that billing date. If it reaches us less than 14 days before the next first, that next monthly payment remains due and the membership ends at the end of the additional paid month.",
        kind="warning",
    )
    add_para(
        doc,
        "A payer may request cancellation through the signed-in cancellation-request flow, or by emailing support@zeroalphafitness.co.uk if the flow is unavailable. The request should identify the payer, participant and membership. We will record the received date and time in Europe/London and send an acknowledgement showing the effective end date and any remaining scheduled charge.",
    )
    add_bullets(
        doc,
        [
            "If the request is received at least 14 calendar days before the next first, no payment is taken on that first and access ends at the end of the preceding day.",
            "If the request is received less than 14 calendar days before the next first, the payment on that first remains due; access continues for that paid month and ends at the end of the day before the following first.",
            "A cancellation request stops later renewals; it does not create a refund for time already supplied or an amount already due, except where the law requires one.",
            "Membership cannot be paused. A request to pause will not be treated as a cancellation unless the payer clearly asks to cancel.",
        ],
    )
    add_para(
        doc,
        "The statutory cooling-off right for a newly formed distance contract is separate and is explained in section 10 and the Cancellation, Refund and Cooling-off Policy. It is not restricted by the ordinary renewal-notice rule above.",
    )

    doc.add_heading("10. Cooling-off and refunds", level=1)
    add_para(
        doc,
        "Where the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 apply, a consumer generally may cancel until the end of 14 days after the day the online service contract is made. If the payer expressly requests immediate performance during that period and then cancels within it, we may deduct only a proportionate amount for services actually supplied, where the law allows. If immediate performance was not expressly requested, different refund consequences may apply. Any statutory refund will be made within 14 days where that is the legal deadline, to the original payment method unless the consumer expressly agrees otherwise, and without a refund fee.",
    )
    add_para(
        doc,
        "Outside a statutory or other mandatory right, payments are non-refundable. Nothing in these Terms excludes remedies for services not provided with reasonable care and skill, misdescription, breach of contract, or any other right that cannot lawfully be excluded.",
    )

    doc.add_heading("11. Failed payments, grace period and disputes", level=1)
    add_para(
        doc,
        "If a recurring payment fails, Stripe may retry it and we may ask the payer to update the payment method. We allow a three-calendar-day past-due grace period from the failed due date, during which related access continues while payment is recovered. If the subscription remains past due after the grace period, access may be suspended until payment succeeds or the membership ends. We do not add an undisclosed late fee or accelerate future monthly payments.",
    )
    add_para(
        doc,
        "When a payment dispute is opened, related access is suspended while the dispute is investigated. If the dispute is resolved in our favour, access may be restored promptly, subject to current membership status, and we will fairly assess any credit or extension needed for paid access that was unavailable. If the dispute is lost or the payment is fully refunded, related access is revoked. This does not remove the payer’s right to raise a genuine complaint, use an applicable chargeback right, or exercise a statutory remedy. Contacting us first may allow a billing error to be resolved more quickly.",
    )

    doc.add_heading("12. Conduct, safety and use of facilities", level=1)
    add_bullets(
        doc,
        [
            "Participants must follow staff instructions, posted rules, equipment guidance and reasonable safeguarding measures.",
            "Participants must use equipment only as instructed, wear suitable clothing and footwear, and behave safely and respectfully.",
            "A participant should stop immediately and tell a member of staff if they feel unwell, unsafe or unable to continue.",
            "Violence, harassment, deliberate damage, dangerous conduct, unauthorised commercial activity or misuse of another person’s membership may result in proportionate restriction or termination after fair consideration of the circumstances.",
            "A guardian must comply with youth arrival, handover, collection and supervision arrangements communicated during onboarding.",
        ],
    )
    add_para(
        doc,
        "We may take immediate, proportionate action where reasonably necessary to protect a person, property, safeguarding or service security. Where appropriate, we will explain the decision and offer a review route.",
    )

    doc.add_heading("13. Health and participation", level=1)
    add_para(
        doc,
        "Physical training carries inherent risks. The participant or guardian is responsible for deciding whether to seek medical advice before participation and for following professional advice. The public purchase form does not request medical details. If information is necessary for safe participation, do not place it in a signature or general support field; use the separate secure onboarding route we provide. The applicable waiver or guardian addendum contains the detailed participation acknowledgement.",
    )

    doc.add_heading("14. Our responsibility", level=1)
    add_para(
        doc,
        "We must provide services with reasonable care and skill. Nothing in these Terms excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, breach of statutory rights, or any liability that cannot lawfully be excluded or limited.",
    )
    add_para(
        doc,
        "Subject to that protection, we are not responsible for loss caused by the participant’s deliberate or unsafe misuse of facilities, breach of clear safety instructions, or an event outside our reasonable control where we took reasonable steps to reduce the effect. We are not responsible for business losses arising from a consumer membership. Any limitation will apply only so far as fair and lawful in the circumstances.",
    )

    doc.add_heading("15. Customer Portal and account security", level=1)
    add_para(
        doc,
        "The Stripe Customer Portal may allow the payer to update a payment method and view invoices. Pause and Stripe’s standard cancellation control are disabled because cancellation uses the notice process in section 9. An AlphaWOD member may open the portal from a signed-in account. A non-app payer may receive a short-lived verified-email link. The recipient must keep links and account credentials secure and tell us promptly about suspected unauthorised use.",
    )

    doc.add_heading("16. Ending or restricting a membership by us", level=1)
    add_para(
        doc,
        "We may suspend or end a membership for non-payment, serious or repeated breach, fraud, misuse, safety or safeguarding risk, or where continuing the service is unlawful or no longer reasonably possible. Except where immediate action is reasonably necessary, we will give notice, explain the reason and allow a reasonable opportunity to put a remediable breach right. Any refund or continuing charge will be assessed fairly and in accordance with the law.",
    )

    doc.add_heading("17. Changes to these Terms", level=1)
    add_para(
        doc,
        "We may update these Terms for legal, regulatory, security or reasonable service reasons. We will not impose a material adverse change retrospectively. Where a change materially affects an active membership, we will give clear advance notice and any fair cancellation right required by law. The version accepted at checkout and any later version lawfully notified will be retained with the acceptance evidence.",
    )

    doc.add_heading("18. Communications, complaints and governing law", level=1)
    add_para(
        doc,
        f"We send service, billing and legal communications to the payer’s recorded email. The payer must keep it current. Complaints should be sent to {SUPPORT_EMAIL} or by post to {ADDRESS}. We will investigate and respond within a reasonable time.",
    )
    add_para(
        doc,
        "These Terms are governed by the law of England and Wales. A consumer living elsewhere in the UK retains any mandatory protection of the part of the UK where they live and may bring proceedings in any court available under applicable consumer law. Nothing in these Terms prevents either party from using another lawful dispute-resolution route.",
    )

    add_acceptance_block(
        doc,
        "Checkout acceptance text",
        [
            "I have read and agree to the Membership Terms and the Cancellation, Refund and Cooling-off Policy, and I acknowledge the Privacy Notice. I confirm that the participant and payer/guardian details I supplied are accurate.",
            "I authorise the initial amount shown and recurring monthly payments through Stripe on the billing schedule shown at checkout, subject to my cancellation and statutory rights.",
            "I expressly request that the membership and any eligible AlphaWOD access begin immediately, before the 14-day cooling-off period ends. I understand that, if I cancel during that period, Zero Alpha Fitness may retain or charge only the proportionate amount permitted by law for services supplied before cancellation.",
        ],
        "payer name and verified payer email",
    )

    add_review_appendix(
        doc,
        [
            "Obtain counsel’s fairness assessment of the 14-day pre-renewal cutoff and the extra monthly charge where notice arrives later, including prominence at catalogue, checkout, confirmation and cancellation request.",
            "Confirm the operational definition of receipt, deadline timestamps, timezone and what happens if the cancellation service or email system is unavailable.",
            "Confirm each membership’s facilities, class access, capacity rules and any required booking/no-show terms before publication.",
            "Set the advance-notice period and customer remedy for future price or material service changes.",
            "Confirm whether an adult participant who is not the payer also becomes a party to any part of the Membership Terms, and reflect that consistently in the signing flow.",
            "Set an explicit rule for a participant aged 17. The approved youth bands end at 16 and this draft requires an adult participant to be 18, so age 17 is intentionally not offered until the owner and counsel approve a route.",
            "Verify the registered office and place of registration disclosures required on the website and commercial documents. The Unit 3 address is recorded here only as the approved public trading/contact address.",
            "Review the suspension/termination and liability clauses against current insurance, house rules, safeguarding policy and complaint procedure.",
            "Verify Welsh/English language, accessibility and durable-medium requirements for the intended customer base and checkout design.",
            "Review these Terms again against any commenced subscription-contract provisions of the Digital Markets, Competition and Consumers Act 2024 before launch and on each material update.",
        ],
        [
            ("Consumer Contracts Regulations 2013", "https://www.legislation.gov.uk/uksi/2013/3134/contents"),
            ("Consumer Rights Act 2015", "https://www.legislation.gov.uk/ukpga/2015/15/contents"),
            ("CMA unfair contract terms guidance", "https://www.gov.uk/government/publications/unfair-contract-terms-cma37"),
            ("CMA fair-contract guidance updated 22 July 2026", "https://www.gov.uk/guidance/writing-a-fair-contract-for-customers"),
            ("Unfair Contract Terms Act 1977", "https://www.legislation.gov.uk/ukpga/1977/50/contents"),
            ("Digital Markets, Competition and Consumers Act 2024", "https://www.legislation.gov.uk/ukpga/2024/13/contents"),
            ("Government response on the subscription-contract regime", "https://www.gov.uk/government/consultations/consultation-on-the-implementation-of-the-new-subscription-contracts-regime/outcome/government-response-to-consultation-on-the-implementation-of-the-new-subscription-contracts-regime-web-accessible-version"),
            ("GOV.UK online-selling requirements", "https://www.gov.uk/online-and-distance-selling-for-businesses/online-selling"),
            ("Stripe subscription billing-cycle documentation", "https://docs.stripe.com/billing/subscriptions/billing-cycle"),
            ("Stripe Customer Portal documentation", "https://docs.stripe.com/customer-management"),
        ],
        high_priority=(
            "The approved policy is a 14-day deadline before the next first-of-month renewal, not cancellation that always takes effect exactly 14 days after request. A late request can therefore keep the contract running for one extra full billing month. The customer-facing wording makes that effect prominent, but counsel must assess fairness and current/forthcoming subscription-contract rules before it is used."
        ),
    )
    path = OUTPUT_DIR / spec.filename
    doc.save(path)
    return path


def build_privacy() -> Path:
    spec = SPECS["privacy"]
    doc = Document()
    configure_document(doc, spec)
    # The privacy notice is the densest draft. Slightly tighter, still-readable
    # body rhythm keeps the short final clause with the customer-facing notice
    # instead of orphaning it on an otherwise blank page before the appendix.
    normal = doc.styles["Normal"]
    normal.font.size = Pt(10.25)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.07
    for list_style in ("List Bullet", "List Number"):
        style = doc.styles[list_style]
        style.font.size = Pt(10.25)
        style.paragraph_format.space_after = Pt(3.5)
        style.paragraph_format.line_spacing = 1.05
    add_document_title(doc, spec)

    doc.add_heading("1. Who we are", level=1)
    add_para(
        doc,
        f"{ENTITY}, company number {COMPANY_NUMBER}, trading as {TRADING_NAME}, is the controller of the personal information described in this Notice. Our public trading and contact address is {ADDRESS}. For privacy questions or requests, email {SUPPORT_EMAIL}.",
    )
    add_para(
        doc,
        "This Notice covers membership buyers and payers, adult participants, children in Youngstars or Teenstars, their parents or guardians, AlphaWOD account holders, and people who contact support or exercise a privacy right.",
    )

    doc.add_heading("Checkout short-form notice", level=2)
    add_quote(
        doc,
        "ZERO ALPHA FITNESS LTD uses these details to set up and manage the participant’s membership, verify age and guardian authority, manage payment through Stripe, and provide eligible AlphaWOD access. Required fields are needed to complete the membership. If you provide details about another person, we will give them our Privacy Notice during onboarding. Marketing is not part of this purchase. Read the Privacy Notice.",
    )

    doc.add_heading("2. The information we collect", level=1)
    doc.add_heading("Identity, eligibility and contact information", level=2)
    add_bullets(
        doc,
        [
            "Participant, payer and guardian names and email addresses.",
            "For youth membership, the child’s date of birth, age band, the guardian’s relationship to the child and declaration of authority.",
            "The Zero Alpha purchase form does not request a phone number or billing address. Stripe may ask the payer directly for information required by a selected payment method or its legal and fraud-prevention checks.",
        ],
    )
    doc.add_heading("Account, membership and agreement information", level=2)
    add_bullets(
        doc,
        [
            "Firebase account identifier, verified email status, sign-in and security records. Authentication providers handle credentials; we do not need to see the payer’s full password.",
            "Selected plan, participant, start date, billing anchor, promotion use, subscription and access status, payment-failure grace period, cancellation request and effective end date.",
            "Typed electronic signature, authority declaration, acceptance statements, accepted document version, timestamp and the audit context actually recorded at acceptance.",
            "AlphaWOD eligibility, account-claim state, bookings, attendance, workout or training entries and performance records for eligible adult users.",
        ],
    )
    doc.add_heading("Payment information", level=2)
    add_para(
        doc,
        "Stripe collects and processes payment details. We expect to receive identifiers and status information such as Stripe customer, Checkout Session, subscription, invoice, payment, refund and dispute references, and limited payment-method information where Stripe makes it available. We do not store full card or bank credentials in the Zero Alpha application.",
    )
    doc.add_heading("Technical, communications and safety information", level=2)
    add_bullets(
        doc,
        [
            "IP address, device/browser information, timestamps, authentication events, security, error and audit logs to the extent the service providers and our implementation record them.",
            "Transactional email delivery events, support correspondence, complaints and privacy requests.",
            "The public purchase form does not request health or injury details. If safety information is needed during onboarding, it must be collected through the separate, clearly explained process provided for that purpose.",
            "Photographs, video or promotional media only through a separate optional consent process; media consent is not a condition of membership.",
        ],
    )

    doc.add_heading("3. Where the information comes from", level=1)
    add_bullets(
        doc,
        [
            "Directly from the payer, participant or guardian during purchase, onboarding, account use or support contact.",
            "From a payer about a different adult participant, or from a guardian about a child.",
            "From Stripe about checkout, billing, payment, refund and dispute events.",
            "Automatically from the site, AlphaWOD, authentication service and security or operational logs.",
            "From authorised staff recording membership, onboarding, attendance, booking or training administration.",
        ],
    )
    add_para(
        doc,
        "When another person gives us an adult participant’s information, we will provide this Notice to that participant at the first direct communication and no later than required by law. For a child, the guardian receives the full Notice and we will provide age-appropriate information to the child during onboarding.",
    )

    doc.add_heading("4. Why we use information and our lawful bases", level=1)
    add_para(doc, "We use personal information only where a lawful basis applies:")
    add_bullets(
        doc,
        [
            "Contract — to take the payer’s payment, create and administer their subscription, send essential billing/service messages, process cancellation and deliver services that are objectively necessary under a contract with that person.",
            "Legitimate interests — to deliver membership to a different adult participant, administer a youth membership, confirm guardian authority and age eligibility, prevent duplicate subscriptions and fraud, secure the service, keep proportionate audit evidence, administer ordinary bookings/training, manage claims and improve reliable operations. Our interests are providing the agreed service, protecting users and the business, and demonstrating what was agreed. We must balance those interests against each person’s rights, with extra weight for children.",
            "Legal obligation — to keep company, accounting and transaction records and make disclosures where a specific law requires it.",
            "Consent — only where a genuinely optional activity requires it, such as optional marketing, promotional media, or a separately designed optional feature using health information. Consent can be withdrawn without affecting earlier lawful use.",
            "Vital interests — exceptionally, where processing is necessary to protect someone’s life and they cannot consent, for example in a genuine emergency.",
        ],
    )
    add_para(
        doc,
        "Service, security, payment and cancellation messages are not marketing. If we introduce marketing, we will keep it separate from purchase acceptance and use consent or another route only where PECR and data-protection law allow it. Every marketing message will offer the required opt-out.",
    )

    doc.add_heading("5. Children and youth membership", level=1)
    add_para(
        doc,
        "Youngstars covers ages 4–11 and Teenstars covers ages 12–16. The guardian is the payer and supplies the child’s details. Children do not receive AlphaWOD access under the initial public youth membership. We use only the information reasonably needed to verify the age option, arrange onboarding, provide the membership, protect the child and maintain appropriate evidence.",
    )
    add_para(
        doc,
        "A child’s data-protection rights belong to the child. Whether a guardian may exercise a right for them depends on the child’s understanding, authority and best interests. We will explain relevant processing in language and a format appropriate to the child’s age. We do not use a guardian’s acceptance of the membership documents as blanket data-protection consent.",
    )

    doc.add_heading("6. Health and other special-category information", level=1)
    add_callout(
        doc,
        "Do not submit health details at checkout",
        "Do not type medical conditions, injuries, medication or other health information into a signature, promotion-code, support or general checkout field. If information is needed for safe participation, use the separate secure onboarding route provided by Zero Alpha Fitness.",
        kind="warning",
    )
    add_para(
        doc,
        "Information about health is special-category data. If we collect it, we need both an Article 6 lawful basis and an Article 9 condition, plus clear information and appropriate safeguards. Some workout or performance entries may reveal health even if they are not labelled medical. Before any such feature is used, we will classify the fields, identify the lawful condition, minimise access and retention, and provide a just-in-time notice. Where explicit consent is the appropriate condition for an optional feature, it will be specific, separate and withdrawable.",
    )

    doc.add_heading("7. Automated status changes and human review", level=1)
    add_para(
        doc,
        "Stripe events and our rules may automatically update subscription status and related access—for example, allowing Adult Unlimited access after confirmed payment, applying a three-day past-due grace period, blocking a duplicate active subscription, suspending access when a dispute opens, restoring it after a dispute is won, or revoking it after a lost dispute or full refund. These rules use payment and membership status rather than profiling a person’s character. A person may contact us for an explanation, correction and human review of an incorrect or exceptional result.",
    )

    doc.add_heading("8. Who receives information", level=1)
    add_para(doc, "We share only what is reasonably necessary with:")
    add_bullets(
        doc,
        [
            "Stripe, payment networks, banks and payment-method providers for Checkout, Billing, payment authentication, fraud prevention, refunds, disputes and the Customer Portal. Stripe may act as our service provider and as an independent controller for some legal, network and fraud purposes under its own notice.",
            "Google Firebase and Google Cloud for authentication, database, server functions and related infrastructure.",
            "Vercel for website delivery, hosting and operational logs.",
            "Resend for transactional email delivery.",
            "Authorised Zero Alpha Fitness staff and contractors who need the information for their role.",
            "Accountants, insurers, legal advisers, courts, regulators, law-enforcement bodies or a buyer/reorganised business where disclosure is lawful, necessary and appropriately protected.",
        ],
    )
    add_para(
        doc,
        "A supplier is not automatically our processor for every activity. We will verify each role, contract and subprocessor before publication and keep access limited to the relevant purpose.",
    )

    doc.add_heading("9. International transfers", level=1)
    add_para(
        doc,
        "Some verified suppliers or their subprocessors may process information outside the UK. Before publication, we will complete and record the supplier, destination and transfer-mechanism audit. For any restricted transfer, we will use an applicable UK adequacy regulation (including the UK Extension to the EU–US Data Privacy Framework only where the recipient and processing are covered) or an approved UK International Data Transfer Agreement or UK Addendum, together with the required risk assessment and supplementary protections. A person may ask us for information about the relevant safeguard.",
    )
    add_callout(
        doc,
        "Publication blocker",
        "Replace or supplement this section with verified supplier entities, material destinations and safeguards after the data-transfer audit. A generic assurance alone is not sufficiently transparent.",
        kind="danger",
    )

    doc.add_heading("10. How long we keep information", level=1)
    add_para(
        doc,
        "We keep information only for as long as needed for the purpose, legal records, security and live disputes, then delete or irreversibly anonymise it. The proposed schedule below is a review draft and must be implemented consistently in production systems and backups:",
    )
    add_bullets(
        doc,
        [
            "Company, accounting, invoice and transaction records — normally six years from the end of the company financial year to which they relate, subject to any longer lawful requirement or live enquiry.",
            "Membership account, subscription, cancellation and essential support records — while active and normally up to six years after the membership or account relationship ends where needed for contract, complaint or claim records; unnecessary live-profile data should be removed sooner.",
            "Adult waiver, guardian authority, acceptance version and signature evidence — a legally reviewed period based on limitation, insurance and safeguarding needs. Proposed starting point: six years after adult membership ends; for a child, until at least the 21st birthday or resolution of a live claim, whichever is later. This proposal requires counsel and insurer approval.",
            "Bookings, attendance and ordinary workout/performance entries — for the operational period communicated in AlphaWOD settings and then deleted or anonymised; final periods must be set before launch.",
            "Authentication, security and technical logs — a short, documented period appropriate to the risk, normally no more than 12 months unless needed for an incident, fraud or claim.",
            "Optional marketing — until consent is withdrawn or the purpose ends, while retaining only a minimal suppression record where needed to honour an opt-out.",
        ],
    )
    add_para(
        doc,
        "A deletion request does not override a lawful need to retain a limited record. Where possible, financial and claims evidence will be separated from the live app profile so unnecessary operational information can be removed.",
    )

    doc.add_heading("11. Cookies, local storage and similar technologies", level=1)
    add_para(
        doc,
        "The site, Firebase authentication, Stripe and hosting services may use cookies, browser storage, device identifiers or similar storage/access technologies for requested sessions, security, payment authentication, fraud prevention and reliable delivery. Strictly necessary technologies do not require consent but still require clear information. Any non-exempt analytics, advertising or cross-service tracking will be disabled until valid consent is obtained. Before launch, we will publish a verified inventory showing provider, purpose, data, duration and whether consent or an exception applies.",
    )

    doc.add_heading("12. Security", level=1)
    add_para(
        doc,
        "We use proportionate technical and organisational measures designed to protect information, including access controls, verified sign-in or short-lived links, separation of payment credentials from the app, audit logging and supplier security terms. No online service is risk-free. If a personal-data breach creates a legally reportable risk, we will notify the ICO and affected people as required.",
    )

    doc.add_heading("13. Your rights", level=1)
    add_para(doc, "Depending on the circumstances, a person may have the right to:")
    add_bullets(
        doc,
        [
            "be informed and obtain access to their personal information;",
            "correct inaccurate or incomplete information;",
            "ask for erasure or restriction;",
            "receive portable information where the legal conditions apply;",
            "withdraw consent at any time where consent is used;",
            "object to direct marketing; and",
            "ask for safeguards and human review concerning qualifying automated decisions.",
        ],
    )
    add_callout(
        doc,
        "Right to object",
        f"You may object to processing based on our legitimate interests. Tell us what you object to and why by emailing {SUPPORT_EMAIL}. We will stop unless we demonstrate compelling legitimate grounds that override your interests, rights and freedoms, or the processing is needed for legal claims. Direct marketing stops when you object.",
        kind="info",
    )
    add_para(
        doc,
        "We may need reasonable information to verify identity and authority before acting. We do not charge for an ordinary request, but the law allows limited exceptions. We will respond within the applicable time and explain any lawful refusal or extension.",
    )

    doc.add_heading("14. Complaints", level=1)
    add_para(
        doc,
        f"Send a data-protection complaint to {SUPPORT_EMAIL} or {ADDRESS}. We will provide a direct route, acknowledge the complaint within 30 days, investigate appropriately, keep the complainant informed and provide the outcome without undue delay. A person may also complain to the UK Information Commissioner’s Office (ICO).",
    )
    p = doc.add_paragraph()
    p.add_run("ICO complaint information: ")
    add_hyperlink(
        p,
        "ico.org.uk/make-a-complaint/data-protection-complaints/",
        "https://ico.org.uk/make-a-complaint/data-protection-complaints/",
    )

    doc.add_heading("15. Changes to this Notice", level=1)
    add_para(
        doc,
        "We will version and date this Notice. If a change materially affects how active-member information is used, we will provide a clear notice before the new use where required. Earlier acceptance and transaction records remain linked to the version provided at the relevant time.",
    )

    add_review_appendix(
        doc,
        [
            "Confirm support@zeroalphafitness.co.uk as the privacy contact, nominate the internal owner, and confirm whether a data protection officer is required or appointed.",
            "Complete the data inventory: exact checkout, Firebase, Stripe, AlphaWOD, log, email, IP/user-agent and payment-method metadata fields actually stored.",
            "Complete a child-focused legitimate-interests assessment and DPIA; prepare distinct child-friendly explanations for ages 4–11 and 12–16 before youth onboarding launches.",
            "Classify AlphaWOD workout/performance fields and design an Article 9 process before collecting any data that reveals health.",
            "Verify each supplier’s current legal entity, role, data-processing agreement, subprocessor list, hosting/log regions and UK transfer mechanism.",
            "Complete the cookie/device-storage inventory and implement consent before any non-exempt technology operates.",
            "Approve and technically enforce the retention/deletion schedule, including backups, abandoned checkouts, support records, child signature evidence and account deletion.",
            "Assess whether Stripe or internal access rules produce solely automated decisions with legal or similarly significant effects, and ensure meaningful human review.",
            "Confirm whether CCTV, incident reports, emergency contacts, photographs/video, marketing or other channels require separate notices or policies.",
            "Verify and document the direct privacy-complaint process introduced in 2026 and the customer-facing ICO details immediately before publication.",
        ],
        [
            ("ICO right to be informed", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/"),
            ("ICO lawful basis: contract", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/contract/"),
            ("ICO children and the UK GDPR", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/"),
            ("ICO special-category conditions", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-conditions-for-processing/"),
            ("ICO international transfers", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/"),
            ("ICO storage limitation", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/"),
            ("ICO storage and access technologies", "https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/"),
            ("ICO data-protection complaints", "https://ico.org.uk/for-organisations/how-to-deal-with-data-protection-complaints/"),
            ("GOV.UK company and accounting records", "https://www.gov.uk/running-a-limited-company/company-and-accounting-records"),
        ],
        high_priority=(
            "The data map, international-transfer audit, exact retention schedule, cookies/device-storage inventory and child-specific DPIA are not yet confirmed. This draft deliberately labels those gaps; publish only after the text matches the implemented systems and current supplier contracts."
        ),
    )
    path = OUTPUT_DIR / spec.filename
    doc.save(path)
    return path


def build_cancellation() -> Path:
    spec = SPECS["cancel"]
    doc = Document()
    configure_document(doc, spec)
    add_document_title(doc, spec)

    doc.add_heading("At a glance", level=1)
    add_bullets(
        doc,
        [
            "Memberships are rolling monthly, with no joining fee, free trial, minimum term or pause option.",
            "The first regular monthly billing date is the next first of the month. A person joining after the first pays the Stripe-displayed prorated amount immediately.",
            "To avoid the next first-of-month payment, the cancellation request must reach us at least 14 calendar days before that billing date.",
            "If the request arrives later, the next first-of-month payment remains due and membership continues through that additional paid month.",
            "Payments are non-refundable except where required by law.",
            "A statutory 14-day cooling-off right for a new online contract is separate from the ordinary renewal-notice rule.",
        ],
    )

    doc.add_heading("1. Start date, proration and monthly renewal", level=1)
    add_para(
        doc,
        "The membership begins when the contract is confirmed. If that is after the first day of the month, Stripe calculates an immediate prorated charge for the period through the start of the next first. The full monthly price is then collected on the next first and every following first while the membership continues. Times and deadlines use Europe/London.",
    )

    doc.add_heading("2. How to request ordinary cancellation", level=1)
    add_numbered(
        doc,
        [
            "Use the signed-in cancellation-request flow. If you cannot access it, email support@zeroalphafitness.co.uk from the payer’s recorded email.",
            "Identify the payer, participant and membership. Do not send card or bank details.",
            "We record when the request reaches the cancellation system or support inbox, not when it was drafted or sent from a device.",
            "We send an acknowledgement showing the recorded receipt time, the final scheduled payment (if any) and the membership end date. Contact us promptly if it is wrong.",
        ],
    )
    add_para(
        doc,
        "Stripe’s Customer Portal allows payment-method updates and invoice viewing. Its built-in pause and cancellation controls are disabled. Opening the portal or removing a payment method is not a cancellation request.",
    )

    doc.add_heading("3. The 14-day renewal deadline", level=1)
    add_callout(
        doc,
        "Important financial commitment",
        "A request must reach us at least 14 calendar days before the next first of the month to stop that payment. If it reaches us less than 14 days before the next first, that payment remains due and cancellation takes effect after the additional paid month.",
        kind="warning",
    )
    add_bullets(
        doc,
        [
            "On-time request: no payment on the next first; access ends at 23:59 Europe/London on the day before it.",
            "Late request: the next first-of-month payment is collected; access continues for that full paid month and ends at 23:59 Europe/London on the day before the following first.",
            "After acknowledgement, no payment should be scheduled beyond the stated final payment. A billing error will be corrected, including any refund required by law or by our confirmation.",
        ],
    )
    doc.add_heading("Worked examples", level=2)
    add_bullets(
        doc,
        [
            "Next billing date 1 June; request received 18 May: this is 14 calendar days before 1 June. No 1 June payment is due and access ends 31 May.",
            "Next billing date 1 June; request received 19 May: this is less than 14 calendar days before 1 June. The 1 June payment remains due and access ends 30 June.",
        ],
    )
    add_para(
        doc,
        "The account flow should display the exact deadline and outcome before submission. If the service was unavailable, send the request by email and retain evidence of delivery; we will assess the circumstances fairly.",
    )

    doc.add_heading("4. Statutory cooling-off for a new online membership", level=1)
    add_para(
        doc,
        "If the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 apply, a consumer generally may cancel an online service contract during the 14-day period beginning after the contract is made. This is a separate right. The ordinary renewal deadline in section 3 does not shorten it.",
    )
    add_para(
        doc,
        "Checkout asks the payer separately to request that membership and eligible AlphaWOD access begin immediately. If the payer makes that express request and cancels during the cooling-off period, we may keep or charge only the proportionate amount the law permits for services actually supplied before cancellation. The balance will be refunded within 14 days, to the original payment method unless the consumer expressly agrees otherwise, and without a refund fee. If immediate performance was not expressly requested, we will not make a deduction that the Regulations prohibit.",
    )
    add_para(
        doc,
        "A service consumer loses the cooling-off right because of full performance within the 14 days only where all legal conditions are met, including the required express request and acknowledgement. Nothing in this policy asks a customer to give up a right unlawfully.",
    )
    add_quote(
        doc,
        "☐ I expressly request that the membership and any eligible AlphaWOD access begin immediately, before the 14-day cooling-off period ends. I understand that, if I cancel during that period, Zero Alpha Fitness may retain or charge only the proportionate amount permitted by law for services supplied before cancellation.",
    )

    doc.add_heading("5. How to use the cooling-off right", level=1)
    add_para(
        doc,
        "Make a clear statement that you want to cancel during the cooling-off period through the cancellation flow or by emailing support@zeroalphafitness.co.uk. You may use the model wording below, but you do not have to use it:",
    )
    add_quote(
        doc,
        "To ZERO ALPHA FITNESS LTD: I give notice that I cancel my membership contract. Payer name: [name]. Participant name: [name]. Contract date: [date]. Payer email: [email]. Date of notice: [date].",
    )

    doc.add_heading("6. Refunds", level=1)
    add_para(
        doc,
        "Payments are non-refundable except where required by law. This means we do not ordinarily refund a correctly calculated proration, a used or unused part of a paid month, a promotion difference, or a payment that remained due because a cancellation request missed the 14-day renewal deadline.",
    )
    add_para(
        doc,
        "We will provide any remedy required for a valid cooling-off cancellation, duplicate or incorrect charge, failure to provide services with reasonable care and skill, material breach, or other statutory right. A contractual no-refund statement never overrides a mandatory remedy.",
    )

    doc.add_heading("7. No pauses", level=1)
    add_para(
        doc,
        "Membership cannot be paused, frozen or placed on holiday hold. A request to pause does not stop billing and is not treated as a cancellation unless it clearly asks us to cancel. If disability, pregnancy, illness or another exceptional circumstance engages a legal duty or makes the standard policy unfair, contact us so we can consider a reasonable and lawful response.",
    )

    doc.add_heading("8. Failed payments and disputes", level=1)
    add_para(
        doc,
        "A failed payment enters a three-calendar-day past-due grace period, during which related access continues. Stripe may retry payment and we may ask the payer to update the method. If payment is still past due after the grace period, access may be suspended. An open payment dispute suspends related access; a dispute won by Zero Alpha Fitness restores eligible access promptly and we will fairly assess any credit or extension needed for paid time that was unavailable; a lost dispute or full refund revokes related access. These access rules do not prevent a genuine complaint, statutory cancellation or lawful chargeback.",
    )

    doc.add_heading("9. Confirmation and contact", level=1)
    add_para(
        doc,
        f"Cancellation and refund communications will be sent to the payer’s recorded email. Questions or complaints: {SUPPORT_EMAIL}. Post: {ENTITY}, {ADDRESS}. Keep the acknowledgement and relevant Stripe receipt.",
    )

    add_review_appendix(
        doc,
        [
            "Counsel must assess the fairness and enforceability of collecting one additional full month where notice arrives less than 14 days before renewal, including whether a less burdensome rule should replace it.",
            "Confirm the exact deadline calculation, treatment of leap years, DST, delivery failures and support inbox outages; the app must compute and display the same result server-side.",
            "Confirm the precise contract-formation timestamp and durable-medium delivery of cancellation instructions and the model form.",
            "Confirm the immediate-performance control is separate, unticked and evidenced, and that cooling-off refund calculations use services actually supplied rather than an arbitrary fixed fee.",
            "Confirm refund timing and payment method rules in the implementation and customer support playbook.",
            "Review exceptional-circumstance handling against equality duties, unfair-terms law and insurance/operational policy.",
            "Re-review before launch and before spring 2027 against the commencement and transition provisions for subscription contracts under the Digital Markets, Competition and Consumers Act 2024.",
        ],
        [
            ("Consumer Contracts Regulations 2013", "https://www.legislation.gov.uk/uksi/2013/3134/contents"),
            ("Government guidance on the Consumer Contracts Regulations", "https://www.gov.uk/government/publications/consumer-contracts-regulations-2013"),
            ("Consumer Rights Act 2015", "https://www.legislation.gov.uk/ukpga/2015/15/contents"),
            ("CMA unfair contract terms guidance", "https://www.gov.uk/government/publications/unfair-contract-terms-cma37"),
            ("CMA fair-contract guidance updated 22 July 2026", "https://www.gov.uk/guidance/writing-a-fair-contract-for-customers"),
            ("Digital Markets, Competition and Consumers Act 2024", "https://www.legislation.gov.uk/ukpga/2024/13/contents"),
            ("Government response on the subscription-contract regime", "https://www.gov.uk/government/consultations/consultation-on-the-implementation-of-the-new-subscription-contracts-regime/outcome/government-response-to-consultation-on-the-implementation-of-the-new-subscription-contracts-regime-web-accessible-version"),
            ("Stripe cancellation documentation", "https://docs.stripe.com/billing/subscriptions/cancel"),
        ],
        high_priority=(
            "The approved late-notice outcome is materially different from cancellation taking effect exactly 14 days after a request: it can continue the contract through the following monthly cycle. The draft uses the approved billing outcome and makes it prominent, but it should not be published without a current UK consumer-law fairness review."
        ),
    )
    path = OUTPUT_DIR / spec.filename
    doc.save(path)
    return path


def build_adult_waiver() -> Path:
    spec = SPECS["adult"]
    doc = Document()
    configure_document(doc, spec)
    add_document_title(doc, spec)

    add_callout(
        doc,
        "Participant must accept personally",
        "Every adult participant signs this document in their own name, even where somebody else pays. The payer separately accepts the Membership Terms and payment obligation.",
        kind="info",
    )

    doc.add_heading("1. Participant declaration", level=1)
    add_para(
        doc,
        "I confirm that I am the named participant, I am aged 18 or over, and the information I provide is accurate. I understand that this document records informed participation and reasonable allocation of risk; it does not remove duties or rights that the law does not allow either party to exclude.",
    )

    doc.add_heading("2. Activities covered", level=1)
    add_para(
        doc,
        "This acknowledgement applies to the Zero Alpha Fitness activities I choose to undertake under my membership, which may include gym use, resistance and cardiovascular training, functional fitness, coached classes, individual or group workouts, use of free weights and machines, conditioning, mobility work and related warm-up or cool-down activity, whether at the facility or at an organised session.",
    )

    doc.add_heading("3. Risks I understand", level=1)
    add_para(
        doc,
        "Physical training has inherent risks even where reasonable care is taken. Depending on the activity, these may include slips, trips, falls, collisions, equipment movement or failure, overexertion, delayed-onset soreness, strains, sprains, fractures, head or spinal injury, aggravation of an existing condition, heat illness, cardiovascular events and, in rare cases, permanent injury or death. Risks may arise from my own actions, other participants, the environment and the nature of strenuous exercise.",
    )
    add_para(
        doc,
        "I voluntarily choose to participate with that understanding. I accept inherent risks that cannot be eliminated by reasonable care, but I do not waive liability for negligence or any statutory right that cannot lawfully be excluded.",
    )

    doc.add_heading("4. Fitness to participate and medical advice", level=1)
    add_bullets(
        doc,
        [
            "I will consider my current fitness, health, experience and the demands of an activity before taking part.",
            "I will seek medical advice before participation where I have symptoms, concerns, a relevant condition, am pregnant or have been advised to limit exercise.",
            "I will follow medical advice and will not participate while impaired by alcohol, non-prescribed drugs, unsafe medication effects, acute illness or injury.",
            "I will tell the appropriate member of staff, through the secure route provided, about information reasonably necessary for safe participation and any change that affects it.",
        ],
    )
    add_callout(
        doc,
        "Health-information channel",
        "The public checkout and typed-signature fields are not designed for medical details. I will not enter health information there. If staff need safety information, I will use the separate onboarding channel and read the just-in-time privacy information.",
        kind="warning",
    )

    doc.add_heading("5. My conduct and safety responsibilities", level=1)
    add_bullets(
        doc,
        [
            "I will follow reasonable instructions, posted rules, equipment guidance and any scaling or exclusion communicated for safety.",
            "I will use equipment only for its intended purpose and only when I know how to do so or have asked for instruction.",
            "I will wear suitable clothing and footwear, keep the training area reasonably clear and act with care toward others.",
            "I will stop immediately and tell staff if I feel pain, dizziness, unusual shortness of breath, faintness, loss of control or any other warning sign.",
            "I will not deliberately conceal a safety issue, attempt a movement beyond my safe capability after being told not to, or disrupt another participant’s safe use of the facility.",
        ],
    )

    doc.add_heading("6. Coaching and results", level=1)
    add_para(
        doc,
        "Coaching and programming are general fitness services, not medical diagnosis or treatment. Results vary and are not guaranteed. I remain responsible for choosing weights, intensity and participation within my capability while following coaching and safety instructions.",
    )

    doc.add_heading("7. Emergency assistance and first aid", level=1)
    add_para(
        doc,
        "If staff reasonably believe urgent assistance is needed, I authorise them to provide or arrange proportionate first aid, contact emergency services and share the minimum information reasonably necessary for that emergency. This does not guarantee the availability of a particular treatment or professional and does not replace my responsibility to obtain medical advice.",
    )

    doc.add_heading("8. Personal property", level=1)
    add_para(
        doc,
        "I remain responsible for personal property I bring to the facility. Zero Alpha Fitness will take reasonable care where it assumes responsibility, but is not responsible for unattended loss or damage caused without its breach of duty. Nothing in this paragraph excludes liability that cannot lawfully be excluded.",
    )

    doc.add_heading("9. Liability and statutory rights", level=1)
    add_para(
        doc,
        "Zero Alpha Fitness must provide its services with reasonable care and skill. Nothing in this document excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, breach of statutory rights, or another liability that cannot be limited by law.",
    )
    add_para(
        doc,
        "So far as fair and lawful, Zero Alpha Fitness is not responsible for harm or loss caused by my deliberate or unsafe misuse, material breach of clear safety instructions, inaccurate information I knowingly provide, or an inherent risk that remained despite reasonable care. Any responsibility will be assessed according to the facts and applicable law, including each party’s contribution.",
    )

    doc.add_heading("10. Privacy and media", level=1)
    add_para(
        doc,
        "The Privacy Notice explains how participant, signature, account, training and incident information is used. This waiver is not consent to marketing, photography, video or promotional use. Any media permission must be optional, specific and separate, and refusing it does not affect membership.",
    )

    doc.add_heading("11. Electronic signature and continuing effect", level=1)
    add_para(
        doc,
        "I intend my typed name and affirmative submission to authenticate and sign this document electronically. I will have an opportunity to review the document before signing and receive or access a durable copy afterwards. The acceptance record will include the document version and timestamp.",
    )
    add_para(
        doc,
        "This acknowledgement continues while I participate under the membership, but it does not silently authorise a materially different risk or remove the need to notify me of a material document change. If one provision is unenforceable, the remaining provisions continue so far as lawful. The law and jurisdiction wording in the Membership Terms applies, subject to mandatory consumer rights.",
    )

    doc.add_heading("Electronic signing arrangement", level=1)
    add_quote(doc, "☐ I confirm that I am the named participant, I am aged 18 or over, and I have read and understood this Adult Participant Waiver and Risk Acknowledgement.")
    add_quote(doc, "☐ I understand the nature of the activities and the inherent risks described above, and I choose to participate subject to my statutory rights and Zero Alpha Fitness’s duty to take reasonable care.")
    add_quote(doc, "☐ I agree to follow safety instructions, stop if I experience warning signs, and use the separate secure onboarding route for relevant safety information rather than entering health details at checkout.")
    add_para(
        doc,
        "Required signature fields: participant full legal name; participant email; typed signature name; signature date/time; membership/order reference; waiver document ID and version. Where payer and participant differ, the participant receives a verified-email signing link and access remains pending until signing is complete.",
    )

    add_review_appendix(
        doc,
        [
            "Have counsel and the insurer review the activity scope, risk description, emergency wording and liability allocation against actual services and cover.",
            "Confirm the secure pre-participation/onboarding process for relevant medical or accessibility information, including Article 9 basis, access, retention and staff response.",
            "Confirm staff qualifications, first-aid arrangements, emergency action plan, equipment inspection and incident reporting; the document cannot substitute for operational controls.",
            "Confirm how an adult participant who is not the payer receives the Privacy Notice and signs from a verified identity before access begins.",
            "Implement immutable or append-only acceptance evidence: exact version, statements, typed name, verified context and timestamp; do not rely on browser localStorage or a mutable profile field.",
            "Keep optional media consent outside this document and outside membership eligibility.",
            "Review accessibility, Welsh-language needs and a paper/assisted alternative for anyone unable to use the electronic flow.",
        ],
        [
            ("Unfair Contract Terms Act 1977, section 2", "https://www.legislation.gov.uk/ukpga/1977/50/section/2"),
            ("Consumer Rights Act 2015", "https://www.legislation.gov.uk/ukpga/2015/15/contents"),
            ("CMA unfair contract terms guidance", "https://www.gov.uk/government/publications/unfair-contract-terms-cma37"),
            ("Law Commission: electronic execution of documents", "https://lawcom.gov.uk/project/electronic-execution-of-documents/"),
            ("HSE health and safety basics for leisure activities", "https://www.hse.gov.uk/entertainment/leisure/basics.htm"),
            ("ICO special-category data guidance", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/"),
        ],
        high_priority=(
            "A waiver does not make an unsafe system safe and cannot exclude liability for death or personal injury caused by negligence. Legal and insurance review must be paired with the real risk assessment, coaching controls, equipment maintenance, emergency plan and incident process."
        ),
    )
    path = OUTPUT_DIR / spec.filename
    doc.save(path)
    return path


def build_guardian() -> Path:
    spec = SPECS["guardian"]
    doc = Document()
    configure_document(doc, spec)
    add_document_title(doc, spec)

    add_callout(
        doc,
        "Guardian is the payer and signer",
        "The adult guardian signs this addendum, accepts the Membership Terms and pays. The child receives an age-appropriate explanation during onboarding. This document does not ask a child to waive rights that cannot lawfully be waived.",
        kind="info",
    )

    doc.add_heading("1. Youth membership covered", level=1)
    add_para(
        doc,
        "This addendum applies to one named child enrolled in Youngstars (minimum age 4, maximum age 11) or Teenstars (minimum age 12, maximum age 16). Eligibility is based on age at the relevant date under the published transition policy. A guardian must contact us if the date of birth or selected age option is wrong.",
    )
    add_para(
        doc,
        "The initial youth membership does not provide the child with AlphaWOD access. Payment confirmation starts the membership contract but does not itself reserve a first session. Zero Alpha Fitness will email the guardian to arrange onboarding and the first session.",
    )

    doc.add_heading("2. Guardian authority and information", level=1)
    add_para(
        doc,
        "I confirm that I am aged 18 or over, I am the child’s parent or legal guardian or otherwise have lawful authority to make the decisions and commitments in this addendum, and I am the payer. If responsibility is shared or restricted by a court order or other arrangement, I confirm that signing and enrolling the child is permitted and I will tell Zero Alpha Fitness promptly about any relevant restriction or change.",
    )
    add_para(
        doc,
        "I confirm that the child’s name, date of birth, age option, my relationship and contact details are accurate. I understand that Zero Alpha Fitness may pause onboarding or participation while it reasonably verifies eligibility or authority.",
    )

    doc.add_heading("3. Activities and risks", level=1)
    add_para(
        doc,
        "Youth activities may include age-appropriate functional fitness, movement skills, bodyweight and resistance exercises, conditioning, games, coached circuits, use of suitable equipment and related warm-up or cool-down activities. The programme should be adapted to age, maturity, experience and the session plan.",
    )
    add_para(
        doc,
        "Physical activity has inherent risks even where reasonable care is taken. These may include slips, trips, falls, collisions, overexertion, soreness, strains, sprains, fractures, equipment-related injury, aggravation of an existing condition and, rarely, serious or permanent injury. I understand those risks and consent to the child’s participation subject to Zero Alpha Fitness’s duty to use reasonable care, appropriate safeguarding and age-appropriate supervision.",
    )

    doc.add_heading("4. Child’s readiness and safety information", level=1)
    add_bullets(
        doc,
        [
            "I will consider whether the child is well enough and ready to participate, seek medical advice where appropriate, and follow professional advice.",
            "I will not send the child to participate while acutely ill, injured, impaired or subject to advice that makes participation unsafe.",
            "I will tell Zero Alpha Fitness promptly, through the secure onboarding route, about information reasonably necessary to adapt or safely manage participation.",
            "I will keep relevant information current and will not ask the child to conceal a material safety concern.",
        ],
    )
    add_callout(
        doc,
        "Do not enter health details in checkout",
        "The public purchase, signature and support fields are not the place for a child’s medical information. Use only the separate secure onboarding channel and read its just-in-time privacy information.",
        kind="warning",
    )

    doc.add_heading("5. Safeguarding, supervision and handover", level=1)
    add_bullets(
        doc,
        [
            "I and the child will follow reasonable safeguarding, behaviour, clothing, equipment and safety instructions.",
            "I will comply with the stated arrival, sign-in, handover and collection process and will provide information about any person authorised or prohibited from collecting the child where lawfully required.",
            "I will arrive and collect on time and will not assume supervision starts before handover or continues after the stated collection point.",
            "I understand that age-appropriate supervised activity still requires the child to listen, behave safely and tell a coach if they feel pain, unwell, unsafe or unable to continue.",
            "Zero Alpha Fitness may stop or adapt an activity, contact me, or take proportionate immediate action where reasonably necessary for safety or safeguarding.",
        ],
    )

    doc.add_heading("6. Emergency assistance", level=1)
    add_para(
        doc,
        "If staff reasonably believe urgent assistance is needed and cannot contact me in time, I authorise them to provide or arrange proportionate first aid, contact emergency services and share the minimum information reasonably necessary to protect the child. Staff will try to contact me as soon as reasonably practicable. This does not guarantee a particular treatment and does not replace professional medical advice.",
    )

    doc.add_heading("7. Membership, payment and cancellation", level=1)
    add_para(
        doc,
        "As payer, I accept the Membership Terms, including the £35 monthly price, first-of-month billing anchor, any Stripe-displayed initial proration, recurring authority, three-day past-due grace period, no-pause rule, and the ordinary 14-day pre-renewal cancellation deadline. I understand that statutory cooling-off and refund rights remain separate and cannot be removed. The Cancellation, Refund and Cooling-off Policy explains the details.",
    )

    doc.add_heading("8. Conduct and proportionate restriction", level=1)
    add_para(
        doc,
        "Zero Alpha Fitness may adapt, pause or end the child’s participation in a session where reasonably necessary for safety, safeguarding, serious disruption or suitability. Any longer restriction or membership termination will be handled fairly under the Membership Terms, with an explanation and review opportunity where appropriate. Reasonable adjustments and relevant legal duties will be considered.",
    )

    doc.add_heading("9. Liability and the child’s rights", level=1)
    add_para(
        doc,
        "Zero Alpha Fitness must provide services with reasonable care and skill. Nothing in this addendum excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, breach of statutory rights, safeguarding duties, or any other liability that cannot lawfully be excluded or limited.",
    )
    add_para(
        doc,
        "I acknowledge inherent risks that remain despite reasonable care. So far as fair and lawful, Zero Alpha Fitness is not responsible for harm caused by deliberate unsafe conduct, material breach of clear instructions, or materially inaccurate information knowingly supplied by the guardian, taking account of the child’s age and all circumstances. The child retains their own rights.",
    )

    doc.add_heading("10. Privacy and the child’s voice", level=1)
    add_para(
        doc,
        "The Privacy Notice explains how child, guardian, signature, membership and incident information is used. I will make the Notice available to the child and support Zero Alpha Fitness in giving an age-appropriate explanation. Data-protection rights belong to the child. My ability to exercise them for the child depends on authority, capacity and the child’s best interests.",
    )
    add_para(
        doc,
        "This addendum is not consent to marketing, photography, video or promotional use. Any media permission will be optional, specific and separate, and refusal will not affect membership.",
    )

    doc.add_heading("11. Electronic signature and changes", level=1)
    add_para(
        doc,
        "I intend my typed name and affirmative submission to authenticate and sign this addendum electronically. I will be able to review it before signing and receive or access a durable copy afterwards. The record will identify the document version and time of acceptance.",
    )
    add_para(
        doc,
        "This addendum continues while the child participates under the youth membership. A material change requires clear notice and any fresh agreement reasonably or legally required. If a provision is unenforceable, the remainder continues so far as lawful. The law and jurisdiction wording in the Membership Terms applies, subject to the child’s and consumer’s mandatory rights.",
    )

    doc.add_page_break()
    doc.add_heading("Guardian electronic signing arrangement", level=1)
    add_quote(doc, "☐ I confirm that I am aged 18 or over, I am the named child’s parent/legal guardian or otherwise have lawful authority, and I am authorised to enrol the child and act as payer.")
    add_quote(doc, "☐ I have read and agree to this Parent/Guardian Consent and Youth Membership Addendum. I understand the activities and inherent risks, and I consent to the child’s participation subject to their statutory rights and Zero Alpha Fitness’s duty to take reasonable care.")
    add_quote(doc, "☐ I agree to follow the onboarding, safety, safeguarding, handover and collection arrangements and to use the secure onboarding route for relevant safety information.")
    add_para(
        doc,
        "Required fields: child full name and date of birth; selected Youngstars/Teenstars option; guardian full legal name and verified email; relationship; authority declaration; typed signature; signature date/time; membership/order reference; addendum document ID and version.",
    )

    add_review_appendix(
        doc,
        [
            "Have safeguarding lead, counsel and insurer review the age bands, programme scope, coach-to-child supervision, handover/collection and emergency wording against actual operations.",
            "Define the age transition rule when a Youngstars child turns 12 or a Teenstars child turns 17, including notice, pricing, service transition and renewed documents.",
            "Confirm what evidence of guardian authority may be requested, how shared responsibility/court restrictions are handled, and who may collect a child.",
            "Complete a child-focused DPIA and legitimate-interests assessment; prepare age-appropriate notices for ages 4–11 and 12–16.",
            "Design the secure safety-information route and Article 9 process before requesting any child health information.",
            "Confirm youth incident reporting, first aid, emergency contact and escalation procedures. The purchase flow currently does not collect a phone number; assess whether a separate onboarding emergency contact is operationally and legally required.",
            "Implement immutable or append-only evidence of the guardian declaration, exact terms, typed signature, verified identity context and timestamp.",
            "Keep media permission separate and optional; confirm photography controls in the safeguarding policy.",
            "Review accessibility, assisted-signing and Welsh-language needs for guardians and children.",
        ],
        [
            ("Consumer Rights Act 2015", "https://www.legislation.gov.uk/ukpga/2015/15/contents"),
            ("Unfair Contract Terms Act 1977, section 2", "https://www.legislation.gov.uk/ukpga/1977/50/section/2"),
            ("Children Act 1989", "https://www.legislation.gov.uk/ukpga/1989/41/contents"),
            ("HSE statement on children’s play and leisure", "https://www.hse.gov.uk/entertainment/childs-play-statement.htm"),
            ("ICO children and the UK GDPR", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/"),
            ("ICO children’s data-protection rights", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/what-data-protection-rights-do-children-have/"),
            ("Law Commission: electronic execution of documents", "https://lawcom.gov.uk/project/electronic-execution-of-documents/"),
        ],
        high_priority=(
            "The youth checkout cannot safely launch on contract text alone. The real safeguarding, age-transition, handover/collection, emergency-contact and special-category-data processes must be defined, reviewed and matched to this addendum."
        ),
    )
    path = OUTPUT_DIR / spec.filename
    doc.save(path)
    return path


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    paths = [
        build_terms(),
        build_privacy(),
        build_cancellation(),
        build_adult_waiver(),
        build_guardian(),
    ]
    for path in paths:
        print(path.resolve())


if __name__ == "__main__":
    main()
