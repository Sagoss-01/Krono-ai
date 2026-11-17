"""
backend/assistant/context.py
----------------------------
Faits calculés avec certitude à partir de l'agenda de l'utilisateur. L'assistant raisonne
sur ces faits et n'invente rien : heures, conflits, créneaux libres, prochain événement,
temps de trajet. Ce module ne lit pas la base et n'appelle pas le réseau : il reçoit des
données déjà chargées, ce qui permet de le tester hors ligne.

Les titres et lieux libres ne sont PAS anonymisés ici : c'est le rôle de brain.py,
qui passe chaque texte libre par la Privacy Gateway. Les dates et heures restent brutes,
car le filtre téléphone de la Privacy Gateway les confondrait avec des numéros.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from backend.scheduler.conflict_engine import ScheduleEvent, detect_conflicts

WORK_START_HOUR = 8
WORK_END_HOUR = 20
MIN_FREE_MINUTES = 30
WINDOW_DAYS = 7  # agenda de la semaine (questions "mon agenda", "demain", "jeudi")


@dataclass
class EventFact:
    ref: str            # référence courte donnée au modèle : E1, E2...
    id: str             # identifiant réel en base
    title: str
    start: datetime
    end: datetime
    location: str
    hard: bool          # contrainte dure : jamais déplacé ni supprimé par l'assistant


def _fmt_day(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def free_slots_today(now: datetime, events: list[EventFact]) -> list[tuple[str, str]]:
    """Créneaux libres d'aujourd'hui entre 8h et 20h, d'au moins 30 minutes."""
    day_start = now.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
    day_end = now.replace(hour=WORK_END_HOUR, minute=0, second=0, microsecond=0)
    cursor = max(day_start, now)
    busy = sorted(
        (e for e in events if e.start.date() == now.date() and e.end > cursor),
        key=lambda e: e.start,
    )
    slots = []
    for e in busy:
        if e.start > cursor and (e.start - cursor) >= timedelta(minutes=MIN_FREE_MINUTES):
            slots.append((cursor, min(e.start, day_end)))
        cursor = max(cursor, e.end)
    if day_end > cursor and (day_end - cursor) >= timedelta(minutes=MIN_FREE_MINUTES):
        slots.append((cursor, day_end))
    return [(a.strftime("%H:%M"), b.strftime("%H:%M")) for a, b in slots if b > a]


def next_event(now: datetime, events: list[EventFact]) -> EventFact | None:
    """Événement en cours, sinon le prochain à venir."""
    for e in sorted(events, key=lambda e: e.start):
        if e.start <= now < e.end:
            return e
    upcoming = [e for e in events if e.start >= now]
    return min(upcoming, key=lambda e: e.start) if upcoming else None


def conflicts_in(events: list[EventFact]) -> list[tuple[EventFact, EventFact]]:
    by_id = {e.id: e for e in events}
    sched = [ScheduleEvent(id=e.id, title=e.title, start=e.start, end=e.end,
                           constraint_type=_ct(e)) for e in events]
    return [(by_id[a.id], by_id[b.id]) for a, b in detect_conflicts(sched)]


def _ct(e: EventFact):
    from backend.models.db_models import ConstraintType
    return ConstraintType.HARD if e.hard else ConstraintType.SOFT


def build_facts(now: datetime, events: list[EventFact], places: list[tuple[str, str]],
                contacts: list[str], travel: dict | None) -> str:
    """Texte des faits, en français, à donner au modèle."""
    window_end = (now + timedelta(days=WINDOW_DAYS)).date()
    window = sorted((e for e in events if now.date() <= e.start.date() < window_end), key=lambda e: e.start)
    lines = [f"Maintenant : {now.strftime('%Y-%m-%d %H:%M')} (heure locale de l'utilisateur)."]

    if window:
        lines.append("Agenda (aujourd'hui et demain) :")
        for e in window:
            flag = " [contrainte dure]" if e.hard else ""
            loc = f" à {e.location}" if e.location else ""
            lines.append(f"- {e.ref} : {_fmt_day(e.start)} {e.start.strftime('%H:%M')}-{e.end.strftime('%H:%M')}, "
                         f"{e.title}{loc}{flag}")
    else:
        lines.append("Agenda : aucun événement aujourd'hui ni demain.")

    cur = next_event(now, window)
    if cur:
        if cur.start <= now < cur.end:
            lines.append(f"Événement en cours : {cur.ref} ({cur.title}), jusqu'à {cur.end.strftime('%H:%M')}.")
        else:
            minutes = int((cur.start - now).total_seconds() // 60)
            lines.append(f"Prochain événement : {cur.ref} ({cur.title}) dans {minutes} minute(s), "
                         f"à {cur.start.strftime('%H:%M')}.")

    today_events = [e for e in window if e.start.date() == now.date()]
    clashes = conflicts_in(today_events)
    if clashes:
        pairs = "; ".join(f"{a.ref} et {b.ref}" for a, b in clashes)
        lines.append(f"Conflits aujourd'hui : {pairs}.")
    free = free_slots_today(now, today_events)
    if free:
        lines.append("Créneaux libres aujourd'hui (8h-20h, 30 min minimum) : " +
                     ", ".join(f"{a}-{b}" for a, b in free) + ".")
    else:
        lines.append("Aucun créneau libre d'au moins 30 minutes aujourd'hui entre 8h et 20h.")

    if places:
        lines.append("Lieux fréquents : " + ", ".join(f"{label} ({kind})" for label, kind in places) + ".")
    if contacts:
        lines.append("Contacts : " + ", ".join(contacts[:15]) + ".")
    if travel:
        lines.append(f"Trajet estimé vers {travel['ref']} ({travel['title']}) depuis {travel['origin']} : "
                     f"{travel['minutes']} min en voiture ; partir vers {travel['leave_at']} pour être à l'heure.")
    return "\n".join(lines)
