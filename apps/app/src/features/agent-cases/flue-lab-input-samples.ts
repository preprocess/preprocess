import { buildStoredZip } from "./case-input-zip";
import { FLUE_LAB_CLIP_MP4 } from "./flue-lab-clip-mp4";

export type CaseInputSample = {
  readonly id: string;
  readonly name: string;
  readonly body: string | Uint8Array;
  readonly type: string;
};

const OOXML_RELS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OOXML_OFFICE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const OOXML_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";

function buildPdf(title: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${title}) Tj T* /F1 12 Tf (SOW covers intake, not SLA.) Tj ET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefAt = body.length;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  return new TextEncoder().encode(
    `${body}${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );
}

function buildWav(): Uint8Array {
  const rate = 8000;
  const samples = rate / 2;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  for (let index = 0; index < samples; index += 1) {
    bytes[44 + index] =
      Math.sin((2 * Math.PI * 440 * index) / rate) > 0 ? 200 : 56;
  }
  return bytes;
}

function officeZip(
  files: ReadonlyArray<{ name: string; body: string }>,
): Uint8Array {
  return buildStoredZip(files);
}

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#171717"/>
  <text x="40" y="80" fill="#f5f5f5" font-family="sans-serif" font-size="32">Acme</text>
  <text x="40" y="128" fill="#a3a3a3" font-family="sans-serif" font-size="18">Vendor diligence</text>
</svg>
`;

export const FLUE_LAB_INPUT_SAMPLES: readonly CaseInputSample[] = [
  {
    id: "sample-notes",
    name: "notes.md",
    type: "text/markdown",
    body: `# Acme vendor diligence

- SOW covers document intake and review, not production SLA.
- Ask legal about the subprocessors list before Friday.
- Follow up with James on the security questionnaire gaps.
`,
  },
  {
    id: "sample-questionnaire",
    name: "questionnaire.md",
    type: "text/markdown",
    body: `# Security questionnaire

1. Where is customer data stored at rest?
2. Who can access production logs?
3. What is the incident notification window?
`,
  },
  {
    id: "sample-notes-txt",
    name: "notes.txt",
    type: "text/plain",
    body: `Acme vendor diligence

SOW covers document intake and review, not production SLA.
Ask legal about the subprocessors list before Friday.
`,
  },
  {
    id: "sample-page",
    name: "page.html",
    type: "text/html",
    body: `<!doctype html>
<html lang="en">
  <body>
    <h1>Acme intake</h1>
    <p>Drop files here during review.</p>
  </body>
</html>
`,
  },
  {
    id: "sample-thread",
    name: "thread.eml",
    type: "message/rfc822",
    body: `From: ada@preprocess.test
To: james@preprocess.test
Subject: Subprocessors
Date: Sat, 15 Aug 2026 15:00:00 +0000

Please confirm the subprocessors list before Friday.
`,
  },
  {
    id: "sample-vendors",
    name: "vendors.csv",
    type: "text/csv",
    body: `name,role,status
Acme,primary,in review
Northwind,subprocessor,approved
Contoso,subprocessor,pending
`,
  },
  {
    id: "sample-mark",
    name: "mark.svg",
    type: "image/svg+xml",
    body: MARK_SVG,
  },
  {
    id: "sample-brief-pdf",
    name: "brief.pdf",
    type: "application/pdf",
    body: buildPdf("Acme vendor brief"),
  },
  {
    id: "sample-take",
    name: "take.wav",
    type: "audio/wav",
    body: buildWav(),
  },
  {
    id: "sample-clip",
    name: "clip.mp4",
    type: "video/mp4",
    body: FLUE_LAB_CLIP_MP4,
  },
  {
    id: "sample-sheet",
    name: "sheet.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: officeZip([
      {
        name: "[Content_Types].xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${OOXML_TYPES}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
      },
      {
        name: "_rels/.rels",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${OOXML_RELS}">
  <Relationship Id="rId1" Type="${OOXML_OFFICE}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${OOXML_RELS}">
  <Relationship Id="rId1" Type="${OOXML_OFFICE}/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="${OOXML_OFFICE}/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`,
      },
      {
        name: "xl/workbook.xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Vendors" sheetId="1" r:id="rId1"/>
    <sheet name="Questions" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,
      },
      {
        name: "xl/worksheets/sheet1.xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Vendor</t></is></c><c r="B1" t="inlineStr"><is><t>Status</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Acme</t></is></c><c r="B2" t="inlineStr"><is><t>in review</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Northwind</t></is></c><c r="B3" t="inlineStr"><is><t>approved</t></is></c></row>
  </sheetData>
</worksheet>`,
      },
      {
        name: "xl/worksheets/sheet2.xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Question</t></is></c><c r="B1" t="inlineStr"><is><t>Owner</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Where is data stored?</t></is></c><c r="B2" t="inlineStr"><is><t>Ada</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Incident window?</t></is></c><c r="B3" t="inlineStr"><is><t>James</t></is></c></row>
  </sheetData>
</worksheet>`,
      },
    ]),
  },
  {
    id: "sample-calc",
    name: "calc.ods",
    type: "application/vnd.oasis.opendocument.spreadsheet",
    body: officeZip([
      {
        name: "mimetype",
        body: "application/vnd.oasis.opendocument.spreadsheet",
      },
      {
        name: "META-INF/manifest.xml",
        body: `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`,
      },
      {
        name: "content.xml",
        body: `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:spreadsheet>
    <table:table table:name="Vendors">
      <table:table-row>
        <table:table-cell><text:p>Vendor</text:p></table:table-cell>
        <table:table-cell><text:p>Status</text:p></table:table-cell>
      </table:table-row>
      <table:table-row>
        <table:table-cell><text:p>Acme</text:p></table:table-cell>
        <table:table-cell><text:p>in review</text:p></table:table-cell>
      </table:table-row>
    </table:table>
  </office:spreadsheet></office:body>
</office:document-content>`,
      },
    ]),
  },
  {
    id: "sample-brief-docx",
    name: "brief.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    body: officeZip([
      {
        name: "[Content_Types].xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${OOXML_TYPES}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      },
      {
        name: "_rels/.rels",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${OOXML_RELS}">
  <Relationship Id="rId1" Type="${OOXML_OFFICE}/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      },
      {
        name: "word/document.xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Acme vendor diligence</w:t></w:r></w:p>
    <w:p><w:r><w:t>SOW covers document intake and review, not production SLA.</w:t></w:r></w:p>
  </w:body>
</w:document>`,
      },
    ]),
  },
  {
    id: "sample-letter",
    name: "letter.odt",
    type: "application/vnd.oasis.opendocument.text",
    body: officeZip([
      {
        name: "content.xml",
        body: `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text>
    <text:p>Acme vendor letter</text:p>
    <text:p>Please confirm the subprocessors list before Friday.</text:p>
  </office:text></office:body>
</office:document-content>`,
      },
    ]),
  },
  {
    id: "sample-drawing",
    name: "drawing.odg",
    type: "application/vnd.oasis.opendocument.graphics",
    body: officeZip([
      {
        name: "content.xml",
        body: `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:drawing>
    <draw:page>
      <text:p>Architecture sketch</text:p>
      <text:p>Intake to review, not production SLA.</text:p>
    </draw:page>
  </office:drawing></office:body>
</office:document-content>`,
      },
    ]),
  },
  {
    id: "sample-deck",
    name: "deck.pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    body: officeZip([
      {
        name: "ppt/slides/slide1.xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <a:p><a:r><a:t>Acme kickoff</a:t></a:r></a:p>
    <a:p><a:r><a:t>SOW covers intake, not SLA.</a:t></a:r></a:p>
  </p:spTree></p:cSld>
</p:sld>`,
      },
      {
        name: "ppt/slides/slide2.xml",
        body: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <a:p><a:r><a:t>Open questions</a:t></a:r></a:p>
    <a:p><a:r><a:t>Subprocessors list before Friday.</a:t></a:r></a:p>
  </p:spTree></p:cSld>
</p:sld>`,
      },
    ]),
  },
  {
    id: "sample-slides",
    name: "slides.odp",
    type: "application/vnd.oasis.opendocument.presentation",
    body: officeZip([
      {
        name: "content.xml",
        body: `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:presentation>
    <draw:page><text:p>Acme kickoff</text:p><text:p>SOW covers intake, not SLA.</text:p></draw:page>
    <draw:page><text:p>Open questions</text:p><text:p>Subprocessors list before Friday.</text:p></draw:page>
  </office:presentation></office:body>
</office:document-content>`,
      },
    ]),
  },
  {
    id: "sample-book",
    name: "book.epub",
    type: "application/epub+zip",
    body: officeZip([
      {
        name: "META-INF/container.xml",
        body: '<container><rootfile full-path="OEBPS/content.opf"/></container>',
      },
      {
        name: "OEBPS/content.opf",
        body: '<package><manifest><item id="cover" href="later.xhtml"/><item id="start" href="start.xhtml"/></manifest><spine><itemref idref="start"/></spine></package>',
      },
      {
        name: "OEBPS/later.xhtml",
        body: "<html><body><p>Later chapter</p></body></html>",
      },
      {
        name: "OEBPS/start.xhtml",
        body: "<html><body><h1>Acme handbook</h1><p>Start here. SOW covers intake, not SLA.</p></body></html>",
      },
    ]),
  },
  {
    id: "sample-pack",
    name: "pack.zip",
    type: "application/zip",
    body: officeZip([
      { name: "inside.txt", body: "Member extracted from the archive.\n" },
    ]),
  },
  {
    id: "sample-legacy",
    name: "legacy.doc",
    type: "application/msword",
    body: "This browser cannot preview .doc. Download instead.\n",
  },
];
