"""
deduplication.py
------------------
Déduplication pour import de calendrier.
"""

from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher


@dataclass
class IncomingEvent:
    external_id: str | None
    source: str
    title: str
    start: datetime
    end: datetime


def _title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _time_overlap_ratio(a: IncomingEvent, b: IncomingEvent) -> float:
    latest_start = max(a.start, b.start)
    earliest_end = min(a.end, b.end)
    overlap = max((earliest_end - latest_start).total_seconds(), 0)
    total_span = max((a.end - a.start).total_seconds(), (b.end - b.start).total_seconds())
    return overlap / total_span if total_span else 0


def deduplicate(
    existing_events: list[IncomingEvent],
    incoming_events: list[IncomingEvent],
    title_threshold: float = 0.85,
    overlap_threshold: float = 0.8,
) -> tuple[list[IncomingEvent], list[IncomingEvent]]:
    to_import: list[IncomingEvent] = []
    duplicates: list[IncomingEvent] = []
    already_selected: list[IncomingEvent] = list(existing_events)
    known_external_ids = {e.external_id for e in existing_events if e.external_id}

    for event in incoming_events:
        if event.external_id and event.external_id in known_external_ids:
            duplicates.append(event)
            continue

        is_duplicate = any(
            _title_similarity(event.title, other.title) >= title_threshold
            and _time_overlap_ratio(event, other) >= overlap_threshold
            for other in already_selected
        )

        if is_duplicate:
            duplicates.append(event)
        else:
            to_import.append(event)
            already_selected.append(event)
            if event.external_id:
                known_external_ids.add(event.external_id)

    return to_import, duplicates
