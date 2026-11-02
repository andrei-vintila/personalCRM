import { defineHandler, readValidatedBody } from "nitro/h3";
import { useDb } from "../../utils/db";
import { resolveParticipants, upsertInteractions } from "../../utils/ingest";
import { importInteractionsSchema } from "../../utils/validation";

/**
 * Imports interactions from an export (e.g. LinkedIn messages). Participants are
 * matched by identity; those marked `create` become contacts if unknown. Re-importing
 * the same export is a no-op thanks to (source, externalId).
 */
export default defineHandler(async (event) => {
  const { source, items } = await readValidatedBody(event, importInteractionsSchema);
  const db = await useDb(event);

  const { contactFor, created } = await resolveParticipants(
    db,
    items.flatMap((i) => i.participants),
    source,
  );
  const written = await upsertInteractions(
    db,
    items.map(({ participants, ...item }) => ({
      ...item,
      source,
      contactIds: participants.map((p) => contactFor(p.kind, p.value)).filter((id): id is string => Boolean(id)),
    })),
  );
  return { interactions: written, contactsCreated: created };
});
