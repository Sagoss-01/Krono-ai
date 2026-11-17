"""
dynamic_optimizer.py
--------------------
Moteur d'optimisation dynamique d'emploi du temps pour transformer des intentions
déduites et données hétérogènes en créneaux idéaux dans le calendrier réel de l'utilisateur.
"""

import uuid
from datetime import datetime, date, time, timedelta
from typing import List, Dict, Any, Optional, Tuple

from backend.models.schemas import FuzzyTaskItem, ScheduleProposalItem, ScheduleProposal
from backend.scheduler.conflict_engine import ScheduleEvent, ConstraintType


FRENCH_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
FRENCH_MONTHS = [
    "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
]


def _format_french_slot(dt: datetime) -> Tuple[str, str, str]:
    """
    Retourne:
      - day_capitalized: ex: "Dimanche"
      - hour_simple: ex: "17h" ou "17h30"
      - full_slot: ex: "Dimanche 6 Septembre à 17h00"
    """
    day_name = FRENCH_DAYS[dt.weekday()].capitalize()
    hour_simple = f"{dt.hour}h" if dt.minute == 0 else f"{dt.hour}h{dt.minute:02d}"
    month_name = FRENCH_MONTHS[dt.month]
    full_slot = f"{day_name} {dt.day} {month_name} à {dt.strftime('%H:%M')}"
    return day_name, hour_simple, full_slot


def optimize_schedule_for_tasks(
    tasks: List[Dict[str, Any]],
    existing_events: List[Any],
    reference_date: Optional[date] = None,
    horizon_days: int = 14
) -> ScheduleProposal:
    """
    Positionne dynamiquement un lot de tâches déduites dans les créneaux
    libres les plus pertinents de l'emploi du temps de l'utilisateur.
    """
    if not reference_date:
        reference_date = date.today()

    # Convertir les événements existants en ScheduleEvent
    working_events: List[ScheduleEvent] = []
    for ev in existing_events:
        if isinstance(ev, ScheduleEvent):
            working_events.append(ev)
        else:
            # SQLAlchemy Event ou dict
            e_id = str(getattr(ev, "id", getattr(ev, "get", lambda k: "")("id")))
            title = getattr(ev, "title", getattr(ev, "get", lambda k: "")("title"))
            start = getattr(ev, "start_time", getattr(ev, "get", lambda k: None)("start_time"))
            end = getattr(ev, "end_time", getattr(ev, "get", lambda k: None)("end_time"))
            ct = getattr(ev, "constraint_type", getattr(ev, "get", lambda k: ConstraintType.SOFT)("constraint_type"))
            
            if isinstance(ct, str):
                ct = ConstraintType.HARD if ct.lower() == "hard" else ConstraintType.SOFT

            if start and end:
                # Si start est une string iso
                if isinstance(start, str):
                    start = datetime.fromisoformat(start)
                if isinstance(end, str):
                    end = datetime.fromisoformat(end)
                working_events.append(ScheduleEvent(id=e_id, title=title, start=start, end=end, constraint_type=ct))

    proposals: List[ScheduleProposalItem] = []

    for task in tasks:
        title = task.get("deduced_title", "Nouvelle tâche")
        category = task.get("category", "personal_care")
        duration_minutes = task.get("duration_minutes", 45)
        duration = timedelta(minutes=duration_minutes)
        preferred_day_type = task.get("preferred_day_type", "any")
        preferred_days = [d.lower() for d in task.get("preferred_days", [])]
        preferred_hour = task.get("preferred_hour")
        preferred_time_of_day = task.get("preferred_time_of_day", "any")
        reasoning = task.get("reasoning", "")
        priority = task.get("priority", "normal")

        # Cas spécifique cheveux / coiffeur : cible prioritaire "dimanche" et "17h"
        is_haircut = any(kw in title.lower() for kw in ["coiffeur", "coiffure", "coupe"])
        if is_haircut:
            preferred_day_type = "weekend"
            if "dimanche" not in preferred_days:
                preferred_days.insert(0, "dimanche")
            if preferred_hour is None:
                preferred_hour = 17

        best_slot: Optional[Tuple[datetime, datetime]] = None
        best_score = -999999.0

        # Exploration des jours dans l'horizon
        for day_offset in range(horizon_days):
            current_day = reference_date + timedelta(days=day_offset)
            weekday_idx = current_day.weekday()
            day_name = FRENCH_DAYS[weekday_idx]
            is_weekend = weekday_idx in (5, 6)

            # Évaluation d'adéquation du jour
            day_score = 0.0
            if preferred_days and day_name in preferred_days:
                # Si c'est exactement le jour préféré numéro 1 (ex: dimanche)
                day_score += 600.0 if day_name == preferred_days[0] else 400.0
            elif preferred_day_type == "weekend" and is_weekend:
                day_score += 350.0
            elif preferred_day_type == "weekday" and not is_weekend:
                day_score += 350.0
            elif preferred_day_type == "any":
                day_score += 150.0
            else:
                day_score -= 250.0

            # Proximité temporelle (favorise le jour le plus proche répondant aux critères)
            day_score -= (day_offset * 12.0)

            # Détermination de la plage horaire à tester
            # Par défaut : 08:30 à 20:30 par pas de 15 minutes
            start_hour = 8
            end_hour = 20

            # Heures candidates
            candidate_times = []
            if preferred_hour is not None:
                # Tester en priorité l'heure préférée exacte, puis ses alentours
                candidate_times.append(time(preferred_hour, 0))
                for delta_m in [15, -15, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120]:
                    ref_dt = datetime.combine(current_day, time(preferred_hour, 0)) + timedelta(minutes=delta_m)
                    if start_hour <= ref_dt.hour <= end_hour:
                        candidate_times.append(ref_dt.time())
            else:
                # Heures selon moment de la journée
                if preferred_time_of_day == "morning":
                    hours = range(9, 12)
                elif preferred_time_of_day == "afternoon":
                    hours = range(14, 17)
                elif preferred_time_of_day == "late_afternoon":
                    hours = range(16, 19)
                elif preferred_time_of_day == "evening":
                    hours = range(18, 21)
                else:
                    hours = range(9, 19)

                for h in hours:
                    for m in (0, 30):
                        candidate_times.append(time(h, m))

            # Test de chaque créneau
            for cand_t in candidate_times:
                cand_start = datetime.combine(current_day, cand_t)
                cand_end = cand_start + duration

                # Ignorer les créneaux passés si c'est aujourd'hui
                if cand_start < datetime.now():
                    continue

                # Vérification de conflit avec les événements de travail
                has_conflict = False
                min_buffer_minutes = 9999

                for we in working_events:
                    # Chevauchement direct
                    if cand_start < we.end and we.start < cand_end:
                        has_conflict = True
                        break

                    # Calcul de la marge (buffer) avec les autres rendez-vous
                    if we.start >= cand_end:
                        gap = (we.start - cand_end).total_seconds() / 60.0
                        if gap < min_buffer_minutes:
                            min_buffer_minutes = gap
                    elif cand_start >= we.end:
                        gap = (cand_start - we.end).total_seconds() / 60.0
                        if gap < min_buffer_minutes:
                            min_buffer_minutes = gap

                if has_conflict:
                    continue

                # Calcul du score de fitness du créneau
                slot_score = 1000.0 + day_score

                # Bonus heure préférée
                if preferred_hour is not None:
                    h_diff = abs((cand_start.hour + cand_start.minute / 60.0) - preferred_hour)
                    slot_score += max(0.0, 450.0 - (h_diff * 90.0))

                # Bonus zone tampon saine (au moins 15 min de marge sans être trop isolé)
                if 15 <= min_buffer_minutes <= 180:
                    slot_score += 60.0

                if slot_score > best_score:
                    best_score = slot_score
                    best_slot = (cand_start, cand_end)

        # Si un créneau optimal a été trouvé
        if best_slot:
            slot_start, slot_end = best_slot
            # Réserver le créneau dans la mémoire de travail pour les prochaines tâches du lot
            temp_id = f"proposal-{uuid.uuid4().hex[:8]}"
            working_events.append(ScheduleEvent(
                id=temp_id,
                title=title,
                start=slot_start,
                end=slot_end,
                constraint_type=ConstraintType.SOFT
            ))

            day_fr, hour_fr, full_slot_fr = _format_french_slot(slot_start)

            # Formulation élégante de la proposition selon la spécification
            # Ex: "Proposition : ajouter un événement « rdv chez le coiffeur » Dimanche à 17h"
            proposal_str = f"Proposition : ajouter un événement « {title} » {day_fr} à {hour_fr}"

            if not reasoning:
                reasoning = f"Créneau optimal de {duration_minutes} min identifié sans conflit dans votre planning."

            proposals.append(ScheduleProposalItem(
                id=temp_id,
                title=title,
                start_time=slot_start,
                end_time=slot_end,
                formatted_slot=f"{day_fr} à {hour_fr}",
                duration_minutes=duration_minutes,
                category=category,
                constraint_type="soft",
                reasoning=reasoning,
                proposal_text=proposal_str
            ))

    # Message récapitulatif
    if len(proposals) == 1:
        p = proposals[0]
        summary = f"{p.proposal_text}\n\n{p.reasoning}"
    elif len(proposals) > 1:
        lines = [f"{i+1}. {p.proposal_text} ({p.duration_minutes} min)" for i, p in enumerate(proposals)]
        summary = "Voici les créneaux dynamiquement optimisés pour vos intentions :\n" + "\n".join(lines)
    else:
        summary = "Aucun créneau libre adéquat n'a pu être trouvé pour ces intentions sans créer de conflit."

    return ScheduleProposal(items=proposals, summary_message=summary)
