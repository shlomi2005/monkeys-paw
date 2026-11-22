// The three ready rounds (paw-web Req 13.7, design "Live gate and ready rounds"). Each is written in advance, with no
// model: a wish from docs/golden-wishes.json, a Grant of three curses, and on every curse a closing EARS clause
// (`binding`) and the Judge's verdict (`verdict`). They play the full round with no /api/grant and no /api/bind.
// Plain data with fixed timestamps and stable ids. Nothing here is stored or sent.

import type { Curse, CurseType, Grant } from 'paw-core';
import type { ExampleEntry } from '../api/api-schemas';

/** One ready round: a wish and its Grant, whose every curse carries a binding and a closing verdict. */
export type ReadyRound = ExampleEntry;

const CREATED_AT = 1767225600000;

interface CurseSpec {
  readonly type: CurseType;
  readonly story: string;
  readonly loophole: string;
  readonly clause: string;
  readonly reason: string;
  readonly property: string;
}

interface RoundSpec {
  readonly id: string;
  readonly text: string;
  readonly context: string;
  readonly narration: string;
  readonly userStory: string;
  readonly wishCriterion: string;
  readonly curses: readonly CurseSpec[];
}

function curseOf(wishId: string, spec: CurseSpec, index: number): Curse {
  const id = `${wishId}-c${index + 1}`;
  const at = CREATED_AT + (index + 1) * 1000;
  return {
    id,
    type: spec.type,
    story: spec.story,
    loophole: spec.loophole,
    status: 'closed',
    binding: { curseId: id, kind: 'ears-clause', clause: spec.clause, proposedAt: at },
    verdict: { curseId: id, closed: true, reason: spec.reason, judgedAt: at + 500, property: spec.property },
  };
}

function roundOf(spec: RoundSpec): ReadyRound {
  const grant: Grant = {
    wishId: spec.id,
    narration: spec.narration,
    curses: spec.curses.map((curse, index) => curseOf(spec.id, curse, index)),
    userStory: spec.userStory,
    wishCriterion: spec.wishCriterion,
  };
  return { wish: { id: spec.id, text: spec.text, context: spec.context, createdAt: CREATED_AT }, grant };
}

const SPECS: readonly RoundSpec[] = [
  {
    id: "ready-1",
    text: "Only the owner can delete a project.",
    context: "a team project-management app",
    narration:
      "Granted. Exactly one person may delete a project, and nothing says that person is still around.",
    userStory:
      "As a team member, I want only the owner to delete a project, so that nobody else can destroy shared work.",
    wishCriterion: "THE SYSTEM SHALL allow only the owner of a project to delete it.",
    curses: [
      {
        type: "permissions",
        story:
          "The owner quits the company. Granted: nobody may delete the project, ever.",
        loophole:
          "\"Only the owner\" names one account, and the wish does not say what happens when that owner leaves.",
        clause:
          "WHEN a project's owner is removed or deactivated, THE SYSTEM SHALL transfer ownership to a team admin, or to the longest-standing member if no admin exists, so that every project always has one owner.",
        reason:
          "The clause names a successor and a fallback, so a project is never left without someone who may delete it.",
        property:
          "For any project whose owner is removed or deactivated, the project has exactly one active owner afterwards, and that owner can delete it.",
      },
      {
        type: "data-loss",
        story:
          "A new hire is made owner on day one. They delete the project in a minute, and nothing brings it back.",
        loophole:
          "\"Delete a project\" does not say how: at once, for good, with no way to undo it.",
        clause:
          "WHEN the owner deletes a project, THE SYSTEM SHALL keep it in a trash for 30 days and restore it, with all its tasks and files, on the owner's request.",
        reason:
          "The trash window and the restore promise make a deletion reversible, so a mistaken delete no longer costs the project.",
        property:
          "For any project deleted by its owner, a restore requested within 30 days returns the project with every task and file it held before the deletion.",
      },
      {
        type: "abuse",
        story:
          "The owner is let go on Friday and deletes the project on the way out. Granted: only the owner may, and the owner did.",
        loophole:
          "\"Only the owner can delete\" gives one person an unchecked power over work the whole team still needs.",
        clause:
          "WHEN the owner deletes a project that has other members, THE SYSTEM SHALL notify every member and every team admin at once and let any admin cancel the deletion within 7 days.",
        reason:
          "Notice and a cancel window for admins limit what one departing owner can destroy, while the owner keeps the right to delete.",
        property:
          "For any deletion of a project with other members, every member and admin is notified, and an admin's cancel within 7 days leaves the project intact.",
      },
    ],
  },
  {
    id: "ready-2",
    text: "Refund the customer if the order arrives late.",
    context: "an online store",
    narration:
      "Granted. Every late order is refunded. What counts as late, the paw does not say.",
    userStory:
      "As a customer, I want a refund when my order arrives late, so that a delay does not cost me money.",
    wishCriterion: "IF an order arrives after its promised delivery date, THEN THE SYSTEM SHALL refund the customer.",
    curses: [
      {
        type: "time",
        story:
          "A parcel due Friday lands at 00:05 on Saturday in Auckland, still Friday at the warehouse. The store calls it on time, the customer calls it late.",
        loophole:
          "\"Arrives late\" names no clock: no delivery date, no time zone, no hour at which late begins.",
        clause:
          "IF the carrier's delivery scan is later than the end of the promised delivery date in the customer's local time zone, THEN THE SYSTEM SHALL mark the order late and start the refund.",
        reason:
          "The clause fixes the clock, the time zone and the moment late begins, so both sides read the same delivery time.",
        property:
          "For any order and any time zone, the order is marked late exactly when its delivery scan falls after the end of the promised date in the customer's local time zone.",
      },
      {
        type: "money",
        story:
          "The order arrives a day late and the customer keeps it. The refund covers everything paid, and the goods stay on the customer's shelf.",
        loophole:
          "\"Refund the customer\" does not say how much, nor whether the goods go back.",
        clause:
          "WHEN an order arrives late, THE SYSTEM SHALL refund the shipping fee in full, and SHALL refund the item price only after the customer returns the goods.",
        reason:
          "The clause fixes the amount: the shipping fee goes back at once and the price of the goods goes back only with the goods.",
        property:
          "For any late order, the refund issued before a return equals the shipping fee, and the item price is refunded only once the goods are marked returned.",
      },
      {
        type: "concurrency",
        story:
          "The carrier's late-delivery event is sent twice, as carriers do. Granted: the customer is refunded twice.",
        loophole:
          "\"Refund the customer if\" runs every time the late event arrives, so each repeat pays out again.",
        clause:
          "WHEN a late-delivery event arrives for an order that has already been refunded for lateness, THE SYSTEM SHALL ignore the event and issue no second refund.",
        reason:
          "The clause makes the refund happen once per order, however many times the carrier repeats its event.",
        property:
          "For any order and any number of repeated late-delivery events, the total refunded for lateness is exactly one refund.",
      },
    ],
  },
  {
    id: "ready-3",
    text: "Students can submit homework until midnight.",
    context: "a school homework portal",
    narration:
      "Granted. Homework closes at midnight. Whose midnight, the paw does not say.",
    userStory:
      "As a student, I want to submit homework until midnight, so that I know exactly when the deadline falls.",
    wishCriterion: "WHILE the deadline has not passed, THE SYSTEM SHALL accept a student's homework submission.",
    curses: [
      {
        type: "time",
        story:
          "The portal counts midnight on the server's clock, set to UTC. A student in New York finds it closed at 7 in the evening.",
        loophole:
          "\"Until midnight\" does not say whose midnight: the server's, the school's or the student's.",
        clause:
          "THE SYSTEM SHALL close each homework deadline at 23:59:59 in the school's local time zone, and SHALL show that time and zone beside the deadline.",
        reason:
          "The clause names one clock, the school's, and shows it to every student, so midnight means the same for all.",
        property:
          "For any deadline and any student time zone, submissions are accepted until 23:59:59 in the school's time zone and rejected afterwards.",
      },
      {
        type: "concurrency",
        story:
          "A student presses Submit at 23:59:58 and the upload lands at 00:00:03. The portal refuses it, and the student's screen still says Sent.",
        loophole:
          "\"Until midnight\" is checked at one moment, and the wish does not say which: the start of the upload, its end or the save.",
        clause:
          "WHEN a student starts a submission before the deadline, THE SYSTEM SHALL accept the file if its upload completes within 5 minutes after the deadline, and SHALL record the start time.",
        reason:
          "The clause fixes the moment that counts, the start of the upload, with a 5-minute grace for a slow one.",
        property:
          "For any submission started before the deadline and completed within 5 minutes after it, the submission is accepted and recorded as on time.",
      },
      {
        type: "accessibility",
        story:
          "A student with a 25 percent time accommodation is shut out with everyone else at midnight. The deadline is the same for all, which is the trouble.",
        loophole:
          "\"Students can submit until midnight\" gives every student the same midnight, with no room for one who is allowed more time.",
        clause:
          "WHERE a teacher has granted a student an extension, THE SYSTEM SHALL accept that student's submissions until the extended time and keep the original deadline for all other students.",
        reason:
          "A per-student extension moves one student's deadline and leaves everyone else's at midnight.",
        property:
          "For any student with a granted extension, submissions are accepted until the extended time, and every other student's deadline is unchanged.",
      },
    ],
  },
];

/** The three rounds, in order. Never mutate them: the session reads them and copies what it changes. */
export const READY_ROUNDS: readonly ReadyRound[] = SPECS.map(roundOf);

/** True when every curse has a binding and a closing verdict: the round replays from memory in every live state. */
export function isReadyRound(entry: ExampleEntry): boolean {
  return (
    entry.grant.curses.length > 0 &&
    entry.grant.curses.every((curse) => curse.binding !== undefined && curse.verdict !== undefined && curse.verdict.closed)
  );
}

/** The ready clause of curse `curseId` in `entry`, or undefined when that curse has none. */
export function readyClauseOf(entry: ExampleEntry | null, curseId: string): string | undefined {
  if (entry === null || !isReadyRound(entry)) return undefined;
  return entry.grant.curses.find((curse) => curse.id === curseId)?.binding?.clause;
}
