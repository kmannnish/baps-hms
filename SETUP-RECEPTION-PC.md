# BAPS Jaipur Utara — Reception PC Setup & Daily Guide

A complete, start-to-finish guide for installing and running the system on the
**Reception PC**. No programming needed. Follow it top to bottom the first time;
after that, only **Part 9 (Daily routine)** matters day to day.

> **Tip:** open this file and use **File → Print → Save as PDF** to keep a printed copy at the desk.

---

## What you'll end up with
- The whole system running on this one PC (one program, one address).
- The app opening **full-screen automatically** every time the receptionist logs in.
- Automatic daily backups.
- (Optional) A public web link so guests can book from any phone and Swami Ji can approve from outside.

---

## Part 1 — Software to install (one time)

Install these **before** anything else:

| Software | Why | Where to get it | Cost |
|---|---|---|---|
| **Docker Desktop** | Runs the app + database | https://www.docker.com/products/docker-desktop | Free |
| **Git for Windows** | Downloads the app + brings updates | https://git-scm.com/download/win | Free |
| **Microsoft Edge** | Shows the app full-screen | Already on Windows | Free |
| **Tailscale** *(optional)* | Public link for guests/Swami Ji | https://tailscale.com/download/windows | Free |

**Installing Docker Desktop:**
1. Download and run the installer. Accept the default options (it will enable "WSL 2").
2. Restart the PC if it asks.
3. Open **Docker Desktop** and wait until the bottom-left says **"Engine running"** (green). The first start can take a couple of minutes.

**Git for Windows:** download, run the installer, accept all defaults. (Needed to download the app and to pull updates later.)

Docker + Git are the two must-haves. Edge is already on Windows; Tailscale is only for the public link (Part 7).

---

## Part 2 — Get the project onto the PC

**Option A — from GitHub (recommended, no file copying).** Needs Git (Part 1). Open PowerShell and run:
```
git clone https://github.com/kmannnish/baps-hms.git C:\baps-hms
```
Sign in as **kmannnish** when the browser opens (the repo is private). This downloads the whole project into `C:\baps-hms` — no ZIP to copy. Installing this way also lets you get future updates with one double-click (Part 12).

**Option B — from a ZIP (only if you're not using GitHub).** Copy the `baps-hms` ZIP onto the PC → right-click → **Extract All…** → choose `C:\` → Extract.

Either way: **keep the `C:\baps-hms` folder where it is** after setup — the auto-start points at it.

---

## Part 3 — Install (the easy way)

1. Make sure **Docker Desktop is open** and shows **"Engine running"**.
2. Open the `baps-hms` folder and **double-click `install-reception.bat`**.
3. A blue window opens and guides you through it (it checks Docker, sets a secret key, builds the app, and sets it to open full-screen at login). The first build takes **a few minutes** — let it finish.
4. When it says **"Setup complete"**, open **http://localhost:4000** — you should see the booking page.

If the installer shows a **red error**, don't worry — do **Part 4** (the same steps by hand) and send me the error text.

---

## Part 4 — Install (the manual way — only if the installer fails)

Open **PowerShell in the project folder** (open the `baps-hms` folder in File Explorer, click the address bar, type `powershell`, press Enter), then run these **one at a time**:

**1. Set a private secret key** — this generates one into a `.env` file (kept out of GitHub):
```
$k = -join (1..48 | % { '{0:x2}' -f (Get-Random -Max 256) }); "JWT_SECRET=$k" | Set-Content .env -Encoding ASCII
```

**2. Build & start the app** (first time takes a few minutes):
```
docker compose up -d --build
```

**3. Open it:** http://localhost:4000

> **Note:** a fresh install already contains everything (rooms set-up, roles, settings). You do **not** run any database "migration" on a brand-new Reception PC — those are only for upgrading a PC that's already running an older copy.

---

## Part 5 — Settings to set once

**A. Make Docker start by itself**
- Docker Desktop → **Settings (gear) → General** → tick **"Start Docker Desktop when you log in"** → **Apply & restart**.
- (The app itself is already set to restart on its own, so once Docker starts, the app starts.)

**B. Change the demo passwords (important!)**
1. Open http://localhost:4000, sign in as **Admin**: mobile `9000000001`, password `password123`.
2. Go to the **Users** tab → for **each** of Admin, Swami Ji, Receptionist, click **Reset password** and set a strong new one.
3. Write the new passwords somewhere safe. **Do this before sharing any public link.**

| Role | Login mobile | Starting password |
|---|---|---|
| Admin | 9000000001 | password123 *(change it)* |
| Swami Ji | 9000000002 | password123 *(change it)* |
| Receptionist | 9000000003 | password123 *(change it)* |

---

## Part 6 — Keys & accounts (only if you need them)

You do **not** need any paid keys. Here's what each optional feature needs:

- **Secret key (required):** created automatically by the installer. Nothing to get.
- **Tailscale account (for the public link):** free — sign in with Google/Microsoft/email when you install Tailscale (Part 7).
- **Gmail App Password (for daily email reports):** free — see Part 8 for exactly how to create one.

---

## Part 7 — Put it online (optional, free)

This gives a permanent public link so **guests can book from anywhere** and **Swami Ji can log in from outside**. Everything still runs on this PC.

1. Install **Tailscale** (Part 1) and **sign in** (free "Personal" plan).
2. Open a PowerShell window (any folder) and run:
   ```
   tailscale funnel --bg 4000
   ```
   - If it says Funnel isn't enabled, open the link it prints, turn **Funnel** on, and run the command again.
3. Get your permanent address:
   ```
   tailscale funnel status
   ```
   It shows something like `https://reception.tailXXXX.ts.net` — **that's your public link.** Share it with guests (as a link or QR) and Swami Ji.

> Tailscale runs in the background and starts with Windows, so the link stays live on its own.

---

## Part 8 — Daily email report to Swami Ji (optional, free)

Sends Swami Ji a daily summary email (income, arrivals, departures, next 7 days).

**First, create a free Gmail App Password:**
1. Use/create a Gmail account for the mandir.
2. Go to **myaccount.google.com → Security** → turn on **2-Step Verification**.
3. Then **Security → App passwords** → create one named "BAPS HMS" → copy the **16-character** code.

**Then add it to the app:**
1. Open the **`.env`** file in the project folder with Notepad and add these lines (your Gmail + the 16-char App Password):
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=youraddress@gmail.com
   SMTP_PASS=your16charAppPassword
   SMTP_FROM=BAPS Jaipur Utara <youraddress@gmail.com>
   ```
2. Save, then in PowerShell (project folder): `docker compose up -d`
3. In the app: Admin → **Content & Messages** → **Daily Report** → turn it on, set the time, enter Swami Ji's email → **Send test now** to check it works.

---

## Part 9 — Daily routine for Reception

**At the start of the day:** just **log in to the PC**. The app opens full-screen by itself. (If it doesn't, double-click the Edge icon and go to `http://localhost:4000`.)

**Through the day:**
- **Floor board** — see every room at a glance (green = ready, red = occupied). Tap a room to check a guest out or change its status. The **All floors** tab shows the whole building at once.
- **Check-ins** — today's expected arrivals. Tap **Assign room & check in** when a guest arrives.
  - If a guest **doesn't turn up / cancels**, tap **Cancel** on their row (add a reason, and an optional cancellation charge).
- **Booking** — create a walk-in booking at the desk; record Swami Ji's phone/WhatsApp approval; or check them straight in.
- **Current guests** — everyone currently staying, in one list.
- **Luggage** — issue/record luggage.
- **Bhojan** — meal head-counts for the kitchen.
- **History** — look up any past or upcoming booking; print/WhatsApp a receipt.

**Online bookings:** a guest books on the public link → it waits for approval → once approved it appears under **Check-ins** to assign a room.

**End of day:** nothing special — backups run automatically.

**To exit the full-screen app** (e.g. to use the PC for something else): press **Alt + F4**.

---

## Part 10 — Backups

- Backups are built in. In **Admin → Backup**, turn on the **Daily** schedule and set a time (e.g. 2:00 AM — the PC must be on then).
- Backups are saved in the **`backups`** folder inside the project. Every so often, **copy that folder to a pen drive** for safe keeping.
- To move everything to a new PC later: on the old PC **Back up now → Download**, then on the new PC put the file in its `backups` folder and use **Restore**.

---

## Part 11 — Troubleshooting

**The app didn't open at login.**
- Open Docker Desktop and wait for "Engine running", then open `http://localhost:4000` in Edge. If Docker wasn't set to start on login, do Part 5A.

**"This site can't be reached" at localhost:4000.**
- Docker isn't up yet. Open Docker Desktop, wait a minute, refresh.
- Check it's running: open PowerShell in the project folder → `docker compose ps` (both lines should say **running**). If not: `docker compose up -d`.

**A guest can't open the public link.**
- Make sure the PC is on and online, and Tailscale is running (its icon is in the system tray). Re-check the link with `tailscale funnel status`.

**I changed `docker-compose.yml` and need to apply it.**
- PowerShell in the project folder → `docker compose up -d`.

**Forgot a staff password.**
- Sign in as Admin → Users → Reset password.

---

## Part 12 — Updating later (one-click, via GitHub)

The project already lives in a private GitHub repo: **`kmannnish/baps-hms`**. Updates
flow through it. Your data is never affected — bookings live in Docker's data volume,
which updates don't touch (and a safety backup is taken automatically before each update).

**Install the Reception PC so it can receive updates:** use **Part 2, Option A** (`git clone`)
rather than a ZIP. A cloned folder is all that's needed to pull updates.

### To publish an update (on the computer where you prepare changes)
After making and testing changes:
```
git add .
git commit -m "what changed"
git push
```
Plain `git push` — the repo is already connected (no `--force`).

### To receive the update (on the Reception PC)
**Double-click `update-reception.bat`.** It takes a safety backup, downloads the update,
rebuilds, and applies any new database changes — about 1–2 minutes. Then hard-refresh the
app (Ctrl + Shift + R).

> **Starting a brand-new repo from scratch** (only if you ever begin again): make a Private
> repo on github.com, then in the project folder run `git init`, `git add .`,
> `git commit -m "v1"`, `git branch -M main`,
> `git remote add origin https://github.com/<you>/<repo>.git`, `git push -u origin main`.
> (The `.env` file and `backups` are excluded automatically, so your key and guest data
> never go to GitHub.)

> **No GitHub at all?** You can still update from a fresh ZIP: replace the code files but
> **keep the `.env` file and the `backups` folder**, then run `docker compose up -d --build`.

---

## Quick reference (commands)

Run these in **PowerShell opened in the project folder**:

| Do this | Command |
|---|---|
| Start / apply changes | `docker compose up -d` |
| Rebuild after a code update | `docker compose up -d --build` |
| Check it's running | `docker compose ps` |
| See recent app logs | `docker compose logs --tail=50 backend` |
| Stop everything | `docker compose down` |
| Public link (after Tailscale) | `tailscale funnel status` |

**App address on this PC:** http://localhost:4000
**Stop the full-screen app:** Alt + F4
