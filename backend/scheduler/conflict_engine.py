"""
conflict_engine.py (Smart-Scheduler)
--------------------------------------
Algorithme de détection et résolution incrémentale des conflits.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from backend.models.db_models import ConstraintType


@dataclass
class ScheduleEvent:
    id: str
    title: str
    start: datetime
    end: datetime
    constraint_type: ConstraintType

    @property
    def duration(self) -> timedelta:
        return self.end - self.start

    def overlaps(self, other: "ScheduleEvent") -> bool:
        return self.start < other.end and other.start < self.end


def detect_conflicts(events: list[ScheduleEvent]) -> list[tuple[ScheduleEvent, ScheduleEvent]]:
    conflicts = []
    sorted_events = sorted(events, key=lambda e: e.start)
    for i in range(len(sorted_events)):
        for j in range(i + 1, len(sorted_events)):
            if sorted_events[i].overlaps(sorted_events[j]):
                conflicts.append((sorted_events[i], sorted_events[j]))
    return conflicts


def find_nearest_free_slot(
    event_to_move: ScheduleEvent,
    all_events: list[ScheduleEvent],
    search_window_hours: int = 12,
    step_minutes: int = 15,
) -> tuple[datetime, datetime] | None:
    duration = event_to_move.duration
    step = timedelta(minutes=step_minutes)
    max_offset = timedelta(hours=search_window_hours)

    other_events = [e for e in all_events if e.id != event_to_move.id]

    offset = step
    while offset <= max_offset:
        for direction in (1, -1):
            candidate_start = event_to_move.start + direction * offset
            candidate_end = candidate_start + duration
            candidate = ScheduleEvent(
                id="candidate", title="", start=candidate_start,
                end=candidate_end, constraint_type=event_to_move.constraint_type,
            )
            if not any(candidate.overlaps(other) for other in other_events):
                return candidate_start, candidate_end
        offset += step

    return None


def resolve_conflicts(events: list[ScheduleEvent]) -> dict[str, tuple[datetime, datetime]]:
    moves: dict[str, tuple[datetime, datetime]] = {}

    working_events = [
        ScheduleEvent(
            id=e.id,
            title=e.title,
            start=e.start,
            end=e.end,
            constraint_type=e.constraint_type
        )
        for e in events
    ]

    max_iterations = 50
    unresolvable_pairs = set()

    for _ in range(max_iterations):
        conflicts = detect_conflicts(working_events)
        active_conflicts = [
            (a, b) for a, b in conflicts
            if (a.id, b.id) not in unresolvable_pairs and (b.id, a.id) not in unresolvable_pairs
        ]

        if not active_conflicts:
            break

        event_a, event_b = active_conflicts[0]

        if event_a.constraint_type == ConstraintType.HARD and event_b.constraint_type == ConstraintType.HARD:
            unresolvable_pairs.add((event_a.id, event_b.id))
            continue

        if event_a.constraint_type == ConstraintType.HARD:
            soft = event_b
        elif event_b.constraint_type == ConstraintType.HARD:
            soft = event_a
        else:
            soft = event_b if event_a.start <= event_b.start else event_a

        new_slot = find_nearest_free_slot(soft, working_events)
        if new_slot:
            new_start, new_end = new_slot
            for we in working_events:
                if we.id == soft.id:
                    we.start = new_start
                    we.end = new_end
                    break
            moves[soft.id] = (new_start, new_end)
        else:
            unresolvable_pairs.add((event_a.id, event_b.id))

    return moves
