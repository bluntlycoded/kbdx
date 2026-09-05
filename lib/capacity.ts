/*
 * How close an event is to full.
 *
 * One definition, because three places were deciding it separately --
 * the seats meter, the row highlight and the count beside the sort --
 * and a threshold duplicated three times is a threshold that will
 * disagree with itself.
 */

export type CapacityLevel = "unknown" | "ok" | "near" | "over";

export type HasCapacity = {
  capacity?: number | null;
  seatsRemaining?: number | null;
  fillPercentage?: number | null;
};

/*
 * Percentage alone is the wrong measure at small capacities.
 *
 * "Communication System Modeling with MATLAB & SIMULINK" holds 20 and
 * has 4 seats left. That is 80%, under an 85% threshold, so it showed
 * no warning at all -- while an event with 30 of 200 seats free, which
 * nobody needs to think about yet, did. Four seats is four seats.
 *
 * So either rule flags it: nearly full as a proportion, or nearly full
 * in absolute terms. Five is the absolute figure because at these
 * capacities (20 to 1800) it is the point where a coordinator can
 * still do something about it, and it flags two events today rather
 * than a screenful.
 */
export const NEAR_PERCENT = 85;
export const NEAR_SEATS = 5;

export function capacityLevel(event: HasCapacity): CapacityLevel {
  /* No figure recorded is not the same as no seats left. */
  if (event.capacity === null || event.capacity === undefined) {
    return "unknown";
  }

  const left = Number(event.seatsRemaining ?? 0);

  if (left < 0) return "over";

  const fill = Number(event.fillPercentage ?? 0);

  if (fill >= NEAR_PERCENT || left <= NEAR_SEATS) return "near";

  return "ok";
}
