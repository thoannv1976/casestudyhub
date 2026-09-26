import { getTranslations } from 'next-intl/server';
import { currentVersionsOf, type Deliverable, type Submission } from '@casestudyhub/shared';

/**
 * What a group handed in, for the staff marking it.
 *
 * One component for both the case study and the class group project, because
 * a lecturer asking "what did they give me" is asking the same question of
 * both - and two copies of this list would drift the moment one of them
 * learned something the other did not.
 *
 * Every file goes through the route handler that checks who is asking. There
 * is no signed URL here on purpose: a signed URL that leaves this page is a
 * permission that outlives the page.
 */
export async function HandedIn({
  deliverables,
  submissions,
}: {
  deliverables: readonly Deliverable[];
  submissions: readonly Submission[];
}) {
  const t = await getTranslations('workspace');
  const tDeliverables = await getTranslations('deliverables');

  // The version that counts is the newest one; the older ones stay readable
  // from the group's own workspace.
  const current = currentVersionsOf([...submissions]);

  return (
    <ul className="space-y-2 text-sm" data-testid="handed-in">
      {deliverables.map((deliverable) => {
        const held = current.find((row) => row.deliverableId === deliverable.id);
        const label = tDeliverables(deliverable.key.replace('deliverables.', ''));

        return (
          <li key={deliverable.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{label}</span>
            {held ? (
              <>
                {held.externalUrl ? (
                  <a
                    href={held.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-600 dark:text-brand-300 underline"
                  >
                    {held.fileName}
                  </a>
                ) : (
                  // A plain anchor, not the locale-aware Link: an API route
                  // has no locale, and prefixing one would ask for a page
                  // that does not exist.
                  <a
                    href={`/api/submissions/${held.id}/file`}
                    className="text-brand-600 dark:text-brand-300 underline"
                  >
                    {held.fileName}
                  </a>
                )}
                <span className="text-muted text-xs">
                  {t('version', { version: held.versionNumber })}
                </span>
                {held.isLate ? (
                  <span className="text-xs text-red-600 dark:text-red-400">{t('late')}</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted">{t('missing')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
