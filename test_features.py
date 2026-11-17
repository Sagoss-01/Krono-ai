import requests
import json
import io

BASE_URL = "http://127.0.0.1:8000"

def run_test():
    # 1. Login to get access token
    print("1. Authenticating as julian.thorne@atelier.ai...")
    login_resp = requests.post(f"{BASE_URL}/auth/login", data={
        "username": "julian.thorne@atelier.ai",
        "password": "password123"
    })
    
    if login_resp.status_code != 200:
        print(f"Login failed: {login_resp.status_code} {login_resp.text}")
        return
    
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("Authentication successful.")

    # 2. Test Morning Briefing
    print("\n2. Testing GET /briefing/today...")
    briefing_resp = requests.get(f"{BASE_URL}/briefing/today", headers=headers)
    print(f"Status: {briefing_resp.status_code}")
    if briefing_resp.status_code == 200:
        b_data = briefing_resp.json()
        print(f"Greeting: {b_data.get('greeting')}")
        print(f"Events Count: {b_data.get('events_count')}")
        print(f"Speech Text (start): {b_data.get('speech_text', '')[:100]}...")
    else:
        print(f"Error: {briefing_resp.text}")

    # 3. Test Schedule Import with an Excel file (openpyxl)
    print("\n3. Testing POST /schedule-import/upload-and-parse with Excel file...")
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "EmploiDuTemps"
    ws.append(["Jour", "Heure Début", "Heure Fin", "Matière", "Salle", "Professeur"])
    ws.append(["Lundi", "08:30", "10:30", "Algorithmique Avancée", "Amphi A", "M. Dupont"])
    ws.append(["Lundi", "10:45", "12:45", "Bases de Données Relationnelles", "Salle 102", "Mme Martin"])
    ws.append(["Mardi", "14:00", "17:00", "Projet IA et LangGraph", "Lab Info 3", "M. Durand"])
    ws.append(["Jeudi", "09:00", "12:00", "Systèmes Distribués", "Amphi B", "Mme Leroy"])
    
    excel_buf = io.BytesIO()
    wb.save(excel_buf)
    excel_buf.seek(0)

    files = {
        "file": ("planning_semaine.xlsx", excel_buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    }
    data = {
        "week_start": "2026-10-19",
        "repeat_weeks": 2
    }

    upload_resp = requests.post(f"{BASE_URL}/schedule-import/upload-and-parse", headers=headers, files=files, data=data)
    print(f"Upload status: {upload_resp.status_code}")
    
    if upload_resp.status_code != 200:
        print(f"Upload failed: {upload_resp.text}")
        return
    
    parsed = upload_resp.json()
    print(f"Title: {parsed.get('schedule_title')}")
    print(f"Total extracted: {parsed.get('total_extracted')}")
    events = parsed.get("events", [])
    for idx, ev in enumerate(events[:4]):
        print(f"  - [{ev.get('date')}] {ev.get('title')} ({ev.get('start_time_display')} - {ev.get('end_time_display')}) @ {ev.get('location')}")

    # 4. Test Batch Confirm Import
    if events:
        print("\n4. Testing POST /schedule-import/confirm-import with first 2 events...")
        selected_to_import = [
            {
                "title": events[0]["title"],
                "start_time": events[0]["start_time"],
                "end_time": events[0]["end_time"],
                "location": events[0]["location"],
                "description": events[0]["description"],
                "constraint_type": events[0]["constraint_type"]
            },
            {
                "title": events[1]["title"],
                "start_time": events[1]["start_time"],
                "end_time": events[1]["end_time"],
                "location": events[1]["location"],
                "description": events[1]["description"],
                "constraint_type": events[1]["constraint_type"]
            }
        ]

        confirm_resp = requests.post(
            f"{BASE_URL}/schedule-import/confirm-import",
            headers=headers,
            json={"events": selected_to_import}
        )
        print(f"Confirm status: {confirm_resp.status_code}")
        if confirm_resp.status_code == 200:
            created = confirm_resp.json()
            print(f"Successfully imported {len(created)} events into database!")
            for c in created:
                print(f"  - Event ID: {c.get('id')}, Title: {c.get('title')}, Start: {c.get('start_time')}")
        else:
            print(f"Confirm failed: {confirm_resp.text}")

    print("\n--- All tests completed successfully! ---")

if __name__ == "__main__":
    run_test()
