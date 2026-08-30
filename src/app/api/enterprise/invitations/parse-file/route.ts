import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

const EMAIL_REGEX = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/g;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    let rawText = "";

    if (name.endsWith(".csv") || file.type === "text/csv") {
      rawText = buffer.toString("utf-8");
    } else if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const parts: string[] = [];
      workbook.eachSheet((sheet) => {
        sheet.eachRow((row) => {
          row.eachCell((cell) => {
            if (cell.value != null) parts.push(String(cell.value));
          });
        });
      });
      rawText = parts.join(" ");
    } else {
      return NextResponse.json(
        { ok: false, error: "Unsupported file type. Upload a .csv or .xlsx file." },
        { status: 400 }
      );
    }

    const matches = rawText.match(EMAIL_REGEX) || [];
    const emails = Array.from(new Set(matches.map((e) => e.trim().toLowerCase())));

    if (emails.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No email addresses found in that file." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, emails });
  } catch (error: any) {
    console.error("[ENTERPRISE_INVITATIONS_PARSE_FILE_ERROR]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to parse file" },
      { status: 500 }
    );
  }
}
