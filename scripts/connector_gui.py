#!/usr/bin/env python3
"""
Rao-Tech Tally Connector Desktop GUI
Standalone Windows Application to bridge TallyPrime (localhost:9000)
with Rao-Tech Cloud (rao-tech-ocr.vercel.app).
"""

import sys
import os
import json
import time
import re
import threading
import platform
import uuid
import urllib.request
import urllib.error
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

DEFAULT_CLOUD = os.environ.get("CLOUD_URL", "https://rao-tech-ocr.vercel.app").strip().rstrip("/")
DEFAULT_TALLY_HOST = os.environ.get("TALLY_HOST", "localhost").strip()
DEFAULT_TALLY_PORT = int(os.environ.get("TALLY_PORT", "9000"))

def get_state_path():
    appdata = os.environ.get("APPDATA")
    if appdata and os.path.exists(appdata):
        folder = os.path.join(appdata, "RaoTech")
        os.makedirs(folder, exist_ok=True)
        return os.path.join(folder, "connector.json")
    return os.path.join(os.getcwd(), ".ref-connector.json")

STATE_FILE = get_state_path()

def clean_xml(s: str) -> str:
    return re.sub(r"&#(?:[0-8]|1[1-2]|1[4-9]|2\d|3[01]);", "", s)

def unescape_xml(s: str) -> str:
    return (
        s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )

def extract_tag(block: str, tag: str) -> str:
    m = re.search(rf"<{tag}[^>]*>([^<]*)</{tag}>", block, re.IGNORECASE)
    return m.group(1).strip() if m else ""

def count_of(xml_str: str, tag: str) -> int:
    m = re.search(rf"<{tag}>\s*(-?\d+)\s*</{tag}>", xml_str, re.IGNORECASE)
    return int(m.group(1)) if m else 0

def line_errors_of(xml_str: str) -> list[str]:
    errors = []
    for m in re.finditer(r"<LINEERROR>([\s\S]*?)</LINEERROR>", xml_str, re.IGNORECASE):
        txt = unescape_xml(m.group(1)).strip()
        if txt:
            errors.append(txt)
    return errors

def parse_tally_response(xml_str: str) -> dict:
    raw = xml_str or ""
    line_errors = line_errors_of(raw)
    created = count_of(raw, "CREATED")
    altered = count_of(raw, "ALTERED")
    deleted = count_of(raw, "DELETED")
    ignored = count_of(raw, "IGNORED")
    combined = count_of(raw, "COMBINED")
    cancelled = count_of(raw, "CANCELLED")
    errors = count_of(raw, "ERRORS")
    exceptions = count_of(raw, "EXCEPTIONS")

    last_vch_match = re.search(r"<LASTVCHID>\s*(\d+)\s*</LASTVCHID>", raw, re.IGNORECASE)
    last_vch_id = int(last_vch_match.group(1)) if last_vch_match and last_vch_match.group(1) != "0" else 0

    ok = (errors == 0 and exceptions == 0 and len(line_errors) == 0 and (created + altered > 0))
    return {
        "ok": ok,
        "created": created,
        "altered": altered,
        "deleted": deleted,
        "ignored": ignored,
        "combined": combined,
        "cancelled": cancelled,
        "errors": errors,
        "exceptions": exceptions,
        "lastVchId": last_vch_id,
        "lastMId": 0,
        "lineErrors": line_errors,
    }


class TallyConnectorApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Rao-Tech Tally Connector")
        self.root.geometry("520x580")
        self.root.minsize(480, 520)
        self.root.configure(bg="#0B0F17")

        self.cloud_url = DEFAULT_CLOUD
        self.tally_host = DEFAULT_TALLY_HOST
        self.tally_port = DEFAULT_TALLY_PORT

        self.running = True
        self.paired = False
        self.token = ""
        self.device_id = ""
        self.device_name = ""

        self.tally_online = False
        self.worker_thread = None

        self._build_ui()
        self._load_state()

        # Start periodic background monitor
        self.worker_thread = threading.Thread(target=self._background_loop, daemon=True)
        self.worker_thread.start()

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self):
        # Header banner
        header_frame = tk.Frame(self.root, bg="#111827", padx=20, pady=16)
        header_frame.pack(fill="x")

        title_lbl = tk.Label(
            header_frame,
            text="RAO-TECH TALLY CONNECTOR",
            font=("Segoe UI", 13, "bold"),
            fg="#F9FAFB",
            bg="#111827",
        )
        title_lbl.pack(anchor="w")

        sub_lbl = tk.Label(
            header_frame,
            text="Real-time bridge between TallyPrime and Rao-Tech Cloud",
            font=("Segoe UI", 9),
            fg="#9CA3AF",
            bg="#111827",
        )
        sub_lbl.pack(anchor="w", pady=(2, 0))

        # Status Cards Frame
        status_frame = tk.Frame(self.root, bg="#0B0F17", padx=20, pady=12)
        status_frame.pack(fill="x")

        # Tally Card
        tally_box = tk.Frame(status_frame, bg="#1F2937", padx=12, pady=10, highlightbackground="#374151", highlightthickness=1)
        tally_box.pack(fill="x", pady=4)

        t_title = tk.Label(tally_box, text="TallyPrime Gateway (localhost:9000)", font=("Segoe UI", 9, "bold"), fg="#D1D5DB", bg="#1F2937")
        t_title.pack(anchor="w")

        self.tally_status_lbl = tk.Label(
            tally_box,
            text="Checking Tally status...",
            font=("Segoe UI", 9),
            fg="#FBBF24",
            bg="#1F2937",
        )
        self.tally_status_lbl.pack(anchor="w", pady=(2, 0))

        # Cloud Card
        cloud_box = tk.Frame(status_frame, bg="#1F2937", padx=12, pady=10, highlightbackground="#374151", highlightthickness=1)
        cloud_box.pack(fill="x", pady=4)

        c_title = tk.Label(cloud_box, text=f"Rao-Tech Cloud ({self.cloud_url})", font=("Segoe UI", 9, "bold"), fg="#D1D5DB", bg="#1F2937")
        c_title.pack(anchor="w")

        self.cloud_status_lbl = tk.Label(
            cloud_box,
            text="Waiting for pairing code...",
            font=("Segoe UI", 9),
            fg="#9CA3AF",
            bg="#1F2937",
        )
        self.cloud_status_lbl.pack(anchor="w", pady=(2, 0))

        # Pairing Card
        self.pair_box = tk.Frame(self.root, bg="#1F2937", padx=16, pady=14, highlightbackground="#374151", highlightthickness=1)
        self.pair_box.pack(fill="x", padx=20, pady=6)

        self.pair_title = tk.Label(
            self.pair_box,
            text="Pair With Rao-Tech Web Dashboard",
            font=("Segoe UI", 10, "bold"),
            fg="#F9FAFB",
            bg="#1F2937",
        )
        self.pair_title.pack(anchor="w")

        self.pair_desc = tk.Label(
            self.pair_box,
            text="Enter the 8-character code shown on Settings -> Tally Connection:",
            font=("Segoe UI", 8),
            fg="#9CA3AF",
            bg="#1F2937",
        )
        self.pair_desc.pack(anchor="w", pady=(2, 8))

        input_row = tk.Frame(self.pair_box, bg="#1F2937")
        input_row.pack(fill="x")

        self.code_entry = tk.Entry(
            input_row,
            font=("Consolas", 14, "bold"),
            bg="#111827",
            fg="#10B981",
            insertbackground="#10B981",
            relief="flat",
            highlightbackground="#4B5563",
            highlightthickness=1,
            justify="center",
        )
        self.code_entry.pack(side="left", fill="x", expand=True, ipady=4, padx=(0, 8))
        self.code_entry.bind("<Return>", lambda e: self._on_pair_click())

        self.pair_btn = tk.Button(
            input_row,
            text="Pair & Connect",
            font=("Segoe UI", 9, "bold"),
            bg="#10B981",
            fg="#FFFFFF",
            activebackground="#059669",
            activeforeground="#FFFFFF",
            relief="flat",
            padx=14,
            pady=4,
            cursor="hand2",
            command=self._on_pair_click,
        )
        self.pair_btn.pack(side="right")

        self.unpair_btn = tk.Button(
            self.pair_box,
            text="Unpair Device",
            font=("Segoe UI", 8),
            bg="#374151",
            fg="#EF4444",
            activebackground="#4B5563",
            activeforeground="#EF4444",
            relief="flat",
            padx=8,
            pady=2,
            cursor="hand2",
            command=self._on_unpair_click,
        )

        # Logs Section
        log_frame = tk.Frame(self.root, bg="#0B0F17", padx=20, pady=8)
        log_frame.pack(fill="both", expand=True)

        log_lbl = tk.Label(log_frame, text="Activity Log", font=("Segoe UI", 9, "bold"), fg="#9CA3AF", bg="#0B0F17")
        log_lbl.pack(anchor="w", pady=(0, 4))

        self.log_area = scrolledtext.ScrolledText(
            log_frame,
            bg="#030712",
            fg="#A7F3D0",
            insertbackground="#A7F3D0",
            font=("Consolas", 8),
            relief="flat",
            highlightbackground="#1F2937",
            highlightthickness=1,
            height=8,
        )
        self.log_area.pack(fill="both", expand=True)

    def log(self, text: str):
        def _append():
            ts = time.strftime("%H:%M:%S")
            self.log_area.insert("end", f"[{ts}] {text}\n")
            self.log_area.see("end")
        self.root.after(0, _append)

    def _load_state(self):
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.token = data.get("token", "")
                    self.device_id = data.get("deviceId", "")
                    self.device_name = data.get("deviceName", "Desktop-Agent")
                    if self.token:
                        self.paired = True
                        self._update_paired_ui(True)
                        self.log(f"Loaded existing pairing for device '{self.device_name}'")
                        return
            except Exception as e:
                self.log(f"Error loading state: {e}")
        self._update_paired_ui(False)

    def _save_state(self):
        try:
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "token": self.token,
                    "deviceId": self.device_id,
                    "deviceName": self.device_name,
                }, f, indent=2)
        except Exception as e:
            self.log(f"Error saving state: {e}")

    def _update_paired_ui(self, is_paired: bool):
        def _apply():
            if is_paired:
                self.pair_title.config(text=f"Paired Device: {self.device_name or 'Desktop Connector'}")
                self.pair_desc.config(text="Device is securely linked with your Rao-Tech workspace.")
                self.code_entry.pack_forget()
                self.pair_btn.pack_forget()
                self.unpair_btn.pack(anchor="w", pady=(6, 0))
                self.cloud_status_lbl.config(text="Live Sync Active — Listening for jobs", fg="#10B981")
            else:
                self.pair_title.config(text="Pair With Rao-Tech Web Dashboard")
                self.pair_desc.config(text="Enter the 8-character code shown on Settings -> Tally Connection:")
                self.unpair_btn.pack_forget()
                self.code_entry.pack(side="left", fill="x", expand=True, ipady=4, padx=(0, 8))
                self.pair_btn.pack(side="right")
                self.cloud_status_lbl.config(text="Not Paired — Enter code to connect", fg="#9CA3AF")
        self.root.after(0, _apply)

    def _on_pair_click(self):
        code = self.code_entry.get().strip().upper()
        if not code:
            messagebox.showwarning("Pairing Code Required", "Please enter the 8-character code shown in your browser.")
            return

        self.pair_btn.config(state="disabled", text="Pairing...")
        self.log(f"Attempting to pair with code: {code}...")

        def _do_pair():
            try:
                machine_id = str(uuid.getnode())
                device_name = platform.node() or "Windows-Desktop"
                payload = json.dumps({
                    "code": code,
                    "deviceName": f"{device_name} (Tally)",
                    "machineId": machine_id,
                    "appVersion": "gui-1.0.0",
                    "osVersion": f"{platform.system()} {platform.release()}",
                }).encode("utf-8")

                req = urllib.request.Request(
                    f"{self.cloud_url}/api/connector/pair",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))

                self.token = data.get("token", "")
                self.device_id = data.get("deviceId", "")
                self.device_name = data.get("deviceName", device_name)
                self.paired = True
                self._save_state()
                self._update_paired_ui(True)
                self.log(f"Successfully paired as '{self.device_name}'!")
                self.root.after(0, lambda: messagebox.showinfo("Connected", "Device paired successfully with Rao-Tech Cloud!"))
            except urllib.error.HTTPError as e:
                err_msg = e.read().decode("utf-8")
                try:
                    err_json = json.loads(err_msg)
                    err_text = err_json.get("error", f"HTTP {e.code}")
                except Exception:
                    err_text = f"HTTP {e.code}"
                self.log(f"Pairing failed: {err_text}")
                self.root.after(0, lambda: messagebox.showerror("Pairing Failed", f"Could not pair device: {err_text}"))
            except Exception as e:
                self.log(f"Pairing error: {e}")
                self.root.after(0, lambda: messagebox.showerror("Connection Error", f"Failed to reach cloud: {e}"))
            finally:
                self.root.after(0, lambda: self.pair_btn.config(state="normal", text="Pair & Connect"))

        threading.Thread(target=_do_pair, daemon=True).start()

    def _on_unpair_click(self):
        if messagebox.askyesno("Confirm Unpair", "Are you sure you want to unpair this machine?"):
            self.paired = False
            self.token = ""
            self.device_id = ""
            if os.path.exists(STATE_FILE):
                try:
                    os.remove(STATE_FILE)
                except Exception:
                    pass
            self._update_paired_ui(False)
            self.log("Device unpaired.")

    def _on_close(self):
        self.running = False
        self.root.destroy()

    # --- Background Network Operations ---

    def ping_tally(self) -> tuple[bool, str]:
        url = f"http://{self.tally_host}:{self.tally_port}"
        req = urllib.request.Request(
            url,
            data=b"<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER></ENVELOPE>",
            headers={"Content-Type": "text/xml;charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    return True, f"Tally is reachable at {url}."
                return False, f"Tally answered HTTP {resp.status}."
        except Exception:
            return False, f"No response from Tally at {url}. Ensure TallyPrime is open."

    def export_xml(self, envelope: str) -> str:
        url = f"http://{self.tally_host}:{self.tally_port}"
        req = urllib.request.Request(
            url,
            data=envelope.encode("utf-8"),
            headers={"Content-Type": "text/xml;charset=utf-8"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8", errors="replace")

    def read_companies(self) -> list[dict]:
        xml = clean_xml(self.export_xml(
            '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>'
            '<TYPE>Collection</TYPE><ID>RefCo</ID></HEADER><BODY><DESC><STATICVARIABLES></STATICVARIABLES>'
            '<TDL><TDLMESSAGE><COLLECTION NAME="RefCo" ISMODIFY="No"><TYPE>Company</TYPE>'
            '<NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>BooksFrom</NATIVEMETHOD>'
            '<NATIVEMETHOD>StartingFrom</NATIVEMETHOD><NATIVEMETHOD>EndingAt</NATIVEMETHOD>'
            '<NATIVEMETHOD>GUID</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
        ))
        companies = []
        for m in re.finditer(r"<COMPANY( [^>]*)?>([\s\S]*?)</COMPANY>", xml, re.IGNORECASE):
            body = m.group(2)
            companies.append({
                "name": unescape_xml(extract_tag(body, "NAME")),
                "startingFrom": extract_tag(body, "STARTINGFROM"),
                "endingAt": extract_tag(body, "ENDINGAT"),
                "guid": extract_tag(body, "GUID"),
            })
        return companies

    def read_ledgers(self, company: str) -> list[dict]:
        vars_tag = f"<STATICVARIABLES><SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY></STATICVARIABLES>" if company else "<STATICVARIABLES></STATICVARIABLES>"
        xml = clean_xml(self.export_xml(
            f'<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>'
            f'<TYPE>Collection</TYPE><ID>RefLed</ID></HEADER><BODY><DESC>{vars_tag}'
            f'<TDL><TDLMESSAGE><COLLECTION NAME="RefLed" ISMODIFY="No"><TYPE>Ledger</TYPE>'
            f'<NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD>'
            f'<NATIVEMETHOD>GUID</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
        ))
        ledgers = []
        for m in re.finditer(r"<LEDGER( [^>]*)?>([\s\S]*?)</LEDGER>", xml, re.IGNORECASE):
            attrs = m.group(1) or ""
            body = m.group(2)
            name_m = re.search(r'\sNAME="([^"]*)"', attrs)
            name = unescape_xml(name_m.group(1)) if name_m else ""
            reserved = 'RESERVEDNAME="' in attrs
            ledgers.append({
                "name": name,
                "parent": unescape_xml(extract_tag(body, "PARENT")),
                "guid": extract_tag(body, "GUID"),
                "reserved": reserved,
            })
        return ledgers

    def handle_job(self, job: dict) -> dict:
        kind = job.get("kind", "")
        payload = job.get("payload") or {}
        company = job.get("companyName") or payload.get("companyName") or ""
        started = time.time()

        if kind == "PING":
            reachable, msg = self.ping_tally()
            return {"ok": reachable, "error": None if reachable else msg}

        if kind == "MASTER_PULL":
            self.log(f"Syncing Master from Tally for company '{company}'...")
            companies = self.read_companies()
            ledgers = self.read_ledgers(company) if company else []
            self.log(f"Master pull done: {len(companies)} company(ies), {len(ledgers)} ledger(s)")
            return {
                "ok": True,
                "companies": companies,
                "ledgers": ledgers,
                "durationMs": int((time.time() - started) * 1000),
            }

        if kind == "MASTER_CREATE":
            xml_data = payload.get("xml", "")
            raw = self.export_xml(xml_data)
            parsed = parse_tally_response(raw)
            return {
                "ok": parsed["ok"],
                "tally": parsed,
                "error": None if parsed["ok"] else " | ".join(parsed["lineErrors"]) or "rejected without reason",
            }

        if kind in ("VOUCHER_PUSH", "VOUCHER_DELETE"):
            vouchers = payload.get("vouchers", [])
            results = []
            for v in vouchers:
                v_id = v.get("voucherId", "")
                v_xml = v.get("xml", "")
                raw = self.export_xml(v_xml)
                parsed = parse_tally_response(raw)
                ok = parsed["ok"]
                results.append({
                    "voucherId": v_id,
                    "ok": ok,
                    "tally": parsed,
                    "error": None if ok else " | ".join(parsed["lineErrors"]) or "error",
                })
                status_txt = "SUCCESS" if ok else "FAILED"
                self.log(f"Voucher {v_id} -> {status_txt}")

            all_ok = all(r["ok"] for r in results)
            return {
                "ok": all_ok,
                "results": results,
                "durationMs": int((time.time() - started) * 1000),
            }

        return {"ok": False, "error": f"unsupported job kind {kind}"}

    def _send_heartbeat(self):
        if not self.token:
            return
        reachable, msg = self.ping_tally()
        payload = json.dumps({
            "tallyReachable": reachable,
            "tallyMessage": msg,
            "tallyHost": self.tally_host,
            "tallyPort": self.tally_port,
            "appVersion": "gui-1.0.0",
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.cloud_url}/api/connector/heartbeat",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10):
                pass
        except Exception as e:
            self.log(f"Heartbeat error: {e}")

    def _background_loop(self):
        last_heartbeat = 0
        last_tally_check = 0

        while self.running:
            now = time.time()

            # Check Tally liveness every 10 seconds
            if now - last_tally_check > 10:
                last_tally_check = now
                reachable, msg = self.ping_tally()
                self.tally_online = reachable
                def _update_tally(r=reachable, m=msg):
                    if r:
                        self.tally_status_lbl.config(text="Online — Connected to TallyPrime (Port 9000)", fg="#10B981")
                    else:
                        self.tally_status_lbl.config(text="Offline — Tally not responding. Ensure Tally is open.", fg="#EF4444")
                self.root.after(0, _update_tally)

            if not self.paired or not self.token:
                time.sleep(1)
                continue

            # Send heartbeat every 30 seconds
            if now - last_heartbeat > 30:
                last_heartbeat = now
                self._send_heartbeat()

            # Long poll for jobs
            try:
                poll_req = urllib.request.Request(
                    f"{self.cloud_url}/api/connector/jobs?wait=15",
                    headers={"Authorization": f"Bearer {self.token}"},
                    method="GET",
                )
                with urllib.request.urlopen(poll_req, timeout=25) as resp:
                    if resp.status == 401:
                        self.log("Token revoked or invalid. Unpairing.")
                        self.paired = False
                        self._update_paired_ui(False)
                        continue

                    data = json.loads(resp.read().decode("utf-8"))
                    job = data.get("job")
                    if not job:
                        continue

                    self.log(f"Job received: {job.get('kind')} ({job.get('id')})")
                    try:
                        result_body = self.handle_job(job)
                    except Exception as err:
                        self.log(f"Job execution failed: {err}")
                        result_body = {"ok": False, "error": str(err)}

                    # Post result back to cloud
                    res_req = urllib.request.Request(
                        f"{self.cloud_url}/api/connector/jobs/{job.get('id')}/result",
                        data=json.dumps(result_body).encode("utf-8"),
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {self.token}",
                        },
                        method="POST",
                    )
                    with urllib.request.urlopen(res_req, timeout=15) as res_resp:
                        self.log(f"Job {job.get('id')} reported successfully (status {res_resp.status})")

            except urllib.error.HTTPError as e:
                if e.code == 401:
                    self.log("Device revoked by web dashboard.")
                    self.paired = False
                    self._update_paired_ui(False)
                else:
                    time.sleep(3)
            except Exception as e:
                # Polling timeout or transient network drop is normal
                time.sleep(2)


def main():
    root = tk.Tk()
    app = TallyConnectorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
