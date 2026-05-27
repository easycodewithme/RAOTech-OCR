type MockInvoiceStatus = "PENDING" | "PROCESSED" | "FAILED";

type MockExtractedData = Record<string, any>;

type MockInvoiceItem = {
  name?: string;
  description?: string;
  hsn_code?: string;
  qty?: number;
  rate?: number;
  amount?: number;
  price?: number;
};

export type MockInvoice = {
  id: string;
  fileUrl: string;
  status: MockInvoiceStatus;
  invoiceNumber?: string | null;
  date?: string | null;
  totalAmount?: number | null;
  taxAmount?: number | null;
  vendor?: string | null;
  vendorGstin?: string | null;
  vendorAddress?: string | null;
  vendorPhone?: string | null;
  customerName?: string | null;
  customerGstin?: string | null;
  subtotal?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  discount?: number | null;
  gstValid?: boolean | null;
  gstState?: string | null;
  ocrEngine?: string | null;
  processingTime?: number | null;
  extractedData?: MockExtractedData | null;
  items?: MockInvoiceItem[] | null;
  createdAt: string;
  updatedAt: string;
};

type MockUser = {
  id: string;
  name: string;
  email: string;
  plan: "FREE" | "PRO" | "ENTERPRISE";
};

type MockGstValidation = {
  is_valid_invoice?: boolean;
  vendor_state?: string;
  vendor_message?: string;
  customer_state?: string;
  customer_message?: string;
};

type MockSaveInput = {
  extractedData: MockExtractedData;
  gstValidation?: MockGstValidation | null;
  fileName?: string | null;
  processingTime?: number | null;
  ocrEngine?: string | null;
};

type MockGlobalState = {
  __mockInvoices?: MockInvoice[];
};

const seedInvoices: MockInvoice[] = [
  {
    id: "inv_1001",
    fileUrl: "acme_oct.pdf",
    status: "PROCESSED",
    invoiceNumber: "ACM-1023",
    date: "2026-04-12T00:00:00.000Z",
    totalAmount: 15240,
    taxAmount: 1800,
    vendor: "Acme Supplies",
    vendorGstin: "29ABCDE1234F1Z5",
    vendorAddress: "12 Market Road, Bengaluru",
    vendorPhone: "08012345678",
    customerName: "Rao Tech Pvt Ltd",
    customerGstin: "29AAACR1234Q1Z2",
    subtotal: 13440,
    cgst: 900,
    sgst: 900,
    igst: null,
    discount: 0,
    gstValid: true,
    gstState: "KA",
    ocrEngine: "mock-ocr",
    processingTime: 0.8,
    extractedData: {
      invoice_number: "ACM-1023",
      date: "12/04/2026",
      total_amount: 15240,
      tax: 1800,
      vendor: "Acme Supplies",
      vendor_gstin: "29ABCDE1234F1Z5",
      vendor_address: "12 Market Road, Bengaluru",
      vendor_phone: "08012345678",
      customer_name: "Rao Tech Pvt Ltd",
      customer_gstin: "29AAACR1234Q1Z2",
      subtotal: 13440,
      cgst: 900,
      sgst: 900,
      igst: 0,
      discount: 0,
      items: [
        { name: "Laser Toner", hsn_code: "8443", qty: 2, rate: 4200, amount: 8400 },
        { name: "Drum Unit", hsn_code: "8443", qty: 1, rate: 5040, amount: 5040 },
      ],
    },
    items: [
      { name: "Laser Toner", hsn_code: "8443", qty: 2, rate: 4200, amount: 8400 },
      { name: "Drum Unit", hsn_code: "8443", qty: 1, rate: 5040, amount: 5040 },
    ],
    createdAt: "2026-04-12T08:30:00.000Z",
    updatedAt: "2026-04-12T08:30:00.000Z",
  },
  {
    id: "inv_1002",
    fileUrl: "nova_supplies.pdf",
    status: "PENDING",
    invoiceNumber: "NV-771",
    date: "2026-04-20T00:00:00.000Z",
    totalAmount: 7800,
    taxAmount: 936,
    vendor: "Nova Traders",
    vendorGstin: "27XYZDE1234F1Z7",
    vendorAddress: "55 Harbor Street, Mumbai",
    vendorPhone: "02255512345",
    customerName: "Rao Tech Pvt Ltd",
    customerGstin: "29AAACR1234Q1Z2",
    subtotal: 6864,
    cgst: 468,
    sgst: 468,
    igst: null,
    discount: 0,
    gstValid: null,
    gstState: "MH",
    ocrEngine: "mock-ocr",
    processingTime: 0.6,
    extractedData: {
      invoice_number: "NV-771",
      date: "20/04/2026",
      total_amount: 7800,
      tax: 936,
      vendor: "Nova Traders",
      vendor_gstin: "27XYZDE1234F1Z7",
      vendor_address: "55 Harbor Street, Mumbai",
      vendor_phone: "02255512345",
      customer_name: "Rao Tech Pvt Ltd",
      customer_gstin: "29AAACR1234Q1Z2",
      subtotal: 6864,
      cgst: 468,
      sgst: 468,
      igst: 0,
      discount: 0,
      items: [
        { name: "Packaging Material", hsn_code: "4819", qty: 12, rate: 320, amount: 3840 },
        { name: "Shipping Labels", hsn_code: "4821", qty: 15, rate: 201.6, amount: 3024 },
      ],
    },
    items: [
      { name: "Packaging Material", hsn_code: "4819", qty: 12, rate: 320, amount: 3840 },
      { name: "Shipping Labels", hsn_code: "4821", qty: 15, rate: 201.6, amount: 3024 },
    ],
    createdAt: "2026-04-20T09:10:00.000Z",
    updatedAt: "2026-04-20T09:10:00.000Z",
  },
  {
    id: "inv_1003",
    fileUrl: "skyline_foods.pdf",
    status: "FAILED",
    invoiceNumber: "SF-8890",
    date: "2026-05-02T00:00:00.000Z",
    totalAmount: 4320,
    taxAmount: 540,
    vendor: "Skyline Foods",
    vendorGstin: "07LMNOP1234F1Z1",
    vendorAddress: "9 Garden Lane, Delhi",
    vendorPhone: "01144556677",
    customerName: "Rao Tech Pvt Ltd",
    customerGstin: "29AAACR1234Q1Z2",
    subtotal: 3780,
    cgst: 270,
    sgst: 270,
    igst: null,
    discount: 0,
    gstValid: false,
    gstState: "DL",
    ocrEngine: "mock-ocr",
    processingTime: 1.1,
    extractedData: {
      invoice_number: "SF-8890",
      date: "02/05/2026",
      total_amount: 4320,
      tax: 540,
      vendor: "Skyline Foods",
      vendor_gstin: "07LMNOP1234F1Z1",
      vendor_address: "9 Garden Lane, Delhi",
      vendor_phone: "01144556677",
      customer_name: "Rao Tech Pvt Ltd",
      customer_gstin: "29AAACR1234Q1Z2",
      subtotal: 3780,
      cgst: 270,
      sgst: 270,
      igst: 0,
      discount: 0,
      items: [
        { name: "Catering Service", hsn_code: "9963", qty: 1, rate: 3780, amount: 3780 },
      ],
    },
    items: [
      { name: "Catering Service", hsn_code: "9963", qty: 1, rate: 3780, amount: 3780 },
    ],
    createdAt: "2026-05-02T11:05:00.000Z",
    updatedAt: "2026-05-02T11:05:00.000Z",
  },
];

const globalForMock = globalThis as typeof globalThis & MockGlobalState;
const mockInvoices = globalForMock.__mockInvoices ?? seedInvoices;
if (!globalForMock.__mockInvoices) {
  globalForMock.__mockInvoices = mockInvoices;
}

const cleanMoney = (val: any): number | null => {
  if (val == null || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "string") {
    const num = parseFloat(val.replace(/[^0-9.-]+/g, ""));
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

const cleanDate = (val: any): string | null => {
  if (!val) return null;
  if (typeof val === "string") {
    const ddmmyyyy = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      const parsed = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const pickField = (data: MockExtractedData, keys: string[]): any => {
  for (const key of keys) {
    if (data[key] != null && data[key] !== "") return data[key];
  }
  return null;
};

const createId = () => `inv_${Math.random().toString(36).slice(2, 10)}`;

export const getMockUser = (): MockUser => ({
  id: "mock-user",
  name: "Demo User",
  email: "demo@raoai.dev",
  plan: "FREE",
});

export const listMockInvoices = (): MockInvoice[] => {
  return [...mockInvoices].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
};

export const getMockInvoice = (id: string): MockInvoice | null => {
  return mockInvoices.find((inv) => inv.id === id) || null;
};

export const saveMockInvoice = (input: MockSaveInput): MockInvoice => {
  const now = new Date();
  const data = input.extractedData || {};

  const invoiceNumber =
    pickField(data, ["invoice_number", "invoiceNumber"]) ||
    `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;

  const dateValue = cleanDate(pickField(data, ["date", "invoice_date"])) || now.toISOString();

  const invoice: MockInvoice = {
    id: createId(),
    fileUrl: input.fileName || "invoice",
    status: "PROCESSED",
    invoiceNumber,
    date: dateValue,
    totalAmount: cleanMoney(pickField(data, ["total_amount", "totalAmount", "total"])),
    taxAmount: cleanMoney(pickField(data, ["tax", "taxAmount", "gst"])),
    vendor: pickField(data, ["vendor", "supplier", "vendor_name"]) || null,
    vendorGstin: pickField(data, ["vendor_gstin", "supplier_gstin"]) || null,
    vendorAddress: pickField(data, ["vendor_address", "supplier_address"]) || null,
    vendorPhone: pickField(data, ["vendor_phone", "supplier_phone"]) || null,
    customerName: pickField(data, ["customer_name", "customer"]) || null,
    customerGstin: pickField(data, ["customer_gstin"]) || null,
    subtotal: cleanMoney(pickField(data, ["subtotal"])),
    cgst: cleanMoney(pickField(data, ["cgst"])),
    sgst: cleanMoney(pickField(data, ["sgst"])),
    igst: cleanMoney(pickField(data, ["igst"])),
    discount: cleanMoney(pickField(data, ["discount"])),
    gstValid: input.gstValidation?.is_valid_invoice ?? null,
    gstState: input.gstValidation?.vendor_state ?? null,
    ocrEngine: input.ocrEngine || "mock-ocr",
    processingTime: input.processingTime ?? null,
    extractedData: data,
    items: Array.isArray(data.items) ? data.items : null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  mockInvoices.unshift(invoice);
  return invoice;
};

export const updateMockInvoice = (id: string, extractedData: MockExtractedData): MockInvoice | null => {
  const invoice = getMockInvoice(id);
  if (!invoice) return null;

  const dateValue = cleanDate(pickField(extractedData, ["date", "invoice_date"]));

  invoice.invoiceNumber = pickField(extractedData, ["invoice_number", "invoiceNumber"]) || invoice.invoiceNumber;
  invoice.date = dateValue || invoice.date;
  invoice.totalAmount = cleanMoney(pickField(extractedData, ["total_amount", "totalAmount", "total"])) ?? invoice.totalAmount;
  invoice.taxAmount = cleanMoney(pickField(extractedData, ["tax", "taxAmount", "gst"])) ?? invoice.taxAmount;
  invoice.vendor = pickField(extractedData, ["vendor", "vendor_name"]) ?? invoice.vendor;
  invoice.vendorGstin = pickField(extractedData, ["vendor_gstin"]) ?? invoice.vendorGstin;
  invoice.vendorAddress = pickField(extractedData, ["vendor_address"]) ?? invoice.vendorAddress;
  invoice.vendorPhone = pickField(extractedData, ["vendor_phone"]) ?? invoice.vendorPhone;
  invoice.customerName = pickField(extractedData, ["customer_name", "customer"]) ?? invoice.customerName;
  invoice.customerGstin = pickField(extractedData, ["customer_gstin"]) ?? invoice.customerGstin;
  invoice.subtotal = cleanMoney(pickField(extractedData, ["subtotal"])) ?? invoice.subtotal;
  invoice.cgst = cleanMoney(pickField(extractedData, ["cgst"])) ?? invoice.cgst;
  invoice.sgst = cleanMoney(pickField(extractedData, ["sgst"])) ?? invoice.sgst;
  invoice.igst = cleanMoney(pickField(extractedData, ["igst"])) ?? invoice.igst;
  invoice.discount = cleanMoney(pickField(extractedData, ["discount"])) ?? invoice.discount;
  invoice.items = Array.isArray(extractedData.items) ? extractedData.items : invoice.items;
  invoice.extractedData = extractedData;
  invoice.updatedAt = new Date().toISOString();

  return invoice;
};

export const deleteMockInvoice = (id: string): boolean => {
  const index = mockInvoices.findIndex((inv) => inv.id === id);
  if (index === -1) return false;
  mockInvoices.splice(index, 1);
  return true;
};

export const getMockExtraction = (fileName?: string) => {
  const now = new Date();
  const shortDate = now.toISOString().slice(0, 10);
  const baseName = fileName ? fileName.replace(/\.[^.]+$/, "") : "invoice";

  return {
    invoice_number: `MOCK-${baseName.toUpperCase().slice(0, 6)}-${shortDate.replace(/-/g, "")}`,
    date: now.toISOString().slice(0, 10),
    vendor: "Mock Vendor Co",
    vendor_gstin: "29MOCKC1234F1Z9",
    vendor_address: "101 Demo Street, Bengaluru",
    vendor_phone: "08000000000",
    customer_name: "Rao Tech Pvt Ltd",
    customer_gstin: "29AAACR1234Q1Z2",
    subtotal: 6400,
    cgst: 576,
    sgst: 576,
    igst: 0,
    discount: 0,
    tax: 1152,
    total_amount: 7552,
    items: [
      { name: "Mock Item A", hsn_code: "8471", qty: 2, rate: 2400, amount: 4800 },
      { name: "Mock Item B", hsn_code: "8471", qty: 1, rate: 1600, amount: 1600 },
    ],
  };
};

export const getMockSummary = (invoices: MockInvoice[]) => {
  const totalAmount = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
  const totalTax = invoices.reduce((sum, inv) => sum + (inv.taxAmount || 0), 0);
  const uniqueVendors = new Set(invoices.map((inv) => inv.vendor).filter(Boolean)).size;

  const periodBreakdown: Record<string, number> = {};
  for (const inv of invoices) {
    const date = inv.date || inv.createdAt;
    const monthKey = new Date(date).toISOString().slice(0, 7);
    periodBreakdown[monthKey] = (periodBreakdown[monthKey] || 0) + (inv.totalAmount || 0);
  }

  const vendorMap: Record<string, { vendor: string; count: number; total_amount: number; total_tax: number }> = {};
  for (const inv of invoices) {
    const vendor = inv.vendor || "Unknown";
    if (!vendorMap[vendor]) {
      vendorMap[vendor] = { vendor, count: 0, total_amount: 0, total_tax: 0 };
    }
    vendorMap[vendor].count += 1;
    vendorMap[vendor].total_amount += inv.totalAmount || 0;
    vendorMap[vendor].total_tax += inv.taxAmount || 0;
  }

  const vendorBreakdown = Object.values(vendorMap)
    .map((v) => ({ ...v, avg_invoice_value: v.count > 0 ? v.total_amount / v.count : 0 }))
    .sort((a, b) => b.total_amount - a.total_amount);

  return {
    total_invoices: invoices.length,
    total_amount: totalAmount,
    total_tax: totalTax,
    unique_vendors: uniqueVendors,
    avg_amount: invoices.length > 0 ? totalAmount / invoices.length : 0,
    period_breakdown: Object.fromEntries(Object.entries(periodBreakdown).sort()),
    vendor_breakdown: vendorBreakdown,
  };
};
