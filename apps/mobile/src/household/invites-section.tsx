import {
  type AssignableRole,
  CreateInviteInputSchema,
  type Household,
  type Invite,
  inviteUrl,
  ROLE_LABELS,
} from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { TextField } from '@/components/text-field';
import { ApiError, createInvite, fetchInvites, reissueInvite, revokeInvite } from '@/lib/api';
import { webUrl } from '@/lib/config';
import { shareLink } from '@/lib/share';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

const DATE = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });

const SHARE_NOTE: Record<string, string> = {
  copied: 'Link copied. Paste it into a message to send it.',
  unavailable: 'Copy the link above and send it in a message.',
};

/**
 * Invites (House Owner / Co-Owner only): invite by email and role, share the
 * link through the share sheet, and see pending invites with "Share again"
 * (a fresh link; the old one stops working) and "Revoke".
 */
export function InvitesSection({ household }: { household: Household }) {
  const { getToken } = useAuth();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'secondary'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchInvites(() => getToken(), household.id)
      .then((list) => {
        if (!alive) return;
        setInvites(list);
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [getToken, household.id, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  async function share(url: string) {
    const outcome = await shareLink(`Join "${household.name}" on bdgtr, our household budget:`, url);
    if (SHARE_NOTE[outcome]) setMessage({ tone: 'secondary', text: SHARE_NOTE[outcome] });
  }

  async function submit() {
    setMessage(null);
    const parsed = CreateInviteInputSchema.safeParse({ email, role });
    if (!parsed.success) {
      setEmailError(parsed.error.issues.find((i) => i.path[0] === 'email')?.message ?? 'Enter a valid email address');
      return;
    }
    setEmailError(undefined);
    setBusy(true);
    try {
      const created = await createInvite(() => getToken(), household.id, parsed.data);
      const url = inviteUrl(webUrl(), created.token);
      setLink({ url, email: created.invite.email });
      setEmail('');
      reload();
      await share(url);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setMessage({
        tone: 'danger',
        text:
          code === 'already_member'
            ? 'That person is already a member of this household.'
            : code === 'invite_limit'
              ? 'Too many pending invites. Revoke some first.'
              : "Couldn't create the invite. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function shareAgain(invite: Invite) {
    setMessage(null);
    setBusy(true);
    try {
      const fresh = await reissueInvite(() => getToken(), household.id, invite.id);
      const url = inviteUrl(webUrl(), fresh.token);
      setLink({ url, email: fresh.invite.email });
      reload();
      await share(url);
    } catch {
      setMessage({ tone: 'danger', text: "Couldn't make a new link. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invite: Invite) {
    setMessage(null);
    setBusy(true);
    try {
      await revokeInvite(() => getToken(), household.id, invite.id);
      if (link?.email === invite.email) setLink(null);
      setMessage({ tone: 'success', text: `Invite to ${invite.email} revoked.` });
      reload();
    } catch {
      setMessage({ tone: 'danger', text: "Couldn't revoke the invite. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <AppText variant="title">Invite someone</AppText>
      <AppText tone="secondary">
        They&apos;ll get a link that works once, for 7 days, and only when they sign in with this email.
      </AppText>
      <View style={styles.form}>
        <TextField
          label="Their email"
          placeholder="name@example.com"
          value={email}
          onChangeText={setEmail}
          error={emailError}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <View role="radiogroup" aria-label="Role" style={styles.roles}>
          {(['member', 'co_owner'] as const).map((r) => (
            <Pressable
              key={r}
              role="radio"
              aria-checked={role === r}
              accessibilityLabel={ROLE_LABELS[r]}
              onPress={() => setRole(r)}
              style={[styles.roleOption, role === r && styles.roleSelected]}
            >
              <AppText variant="bodyStrong">{ROLE_LABELS[r]}</AppText>
              <AppText variant="caption" tone="secondary">
                {r === 'member' ? 'Enters spending, sees everything' : 'Also manages budgets and members'}
              </AppText>
            </Pressable>
          ))}
        </View>
        <Button label="Create invite link" variant="primary" icon="share-variant" busy={busy} onPress={() => void submit()} />
      </View>

      {link ? (
        <View style={styles.linkBox}>
          <AppText variant="caption" tone="secondary">{`Invite link for ${link.email}`}</AppText>
          <AppText selectable style={styles.url}>
            {link.url}
          </AppText>
          <Button label="Share link" icon="share-variant" compact onPress={() => void share(link.url)} />
        </View>
      ) : null}

      {message ? (
        <AppText tone={message.tone} aria-live="polite">
          {message.text}
        </AppText>
      ) : null}

      <AppText variant="bodyStrong" style={styles.pendingTitle}>
        Pending invites
      </AppText>
      {loadError ? (
        <View style={styles.form}>
          <AppText tone="danger" role="alert">
            Couldn&apos;t load the invites.
          </AppText>
          <Button label="Try again" compact onPress={reload} />
        </View>
      ) : !invites ? (
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading invites" />
      ) : invites.length === 0 ? (
        <AppText tone="secondary">No pending invites.</AppText>
      ) : (
        <View role="list" style={styles.list}>
          {invites.map((inv) => (
            <View key={inv.id} role="listitem" style={styles.row}>
              <AppText variant="bodyStrong">{inv.email}</AppText>
              <AppText variant="caption" tone="secondary">
                {`${ROLE_LABELS[inv.role]} · expires ${DATE.format(new Date(inv.expiresAt))}`}
              </AppText>
              <View style={styles.actions}>
                <Button
                  label="Share again"
                  compact
                  busy={busy}
                  accessibilityLabel={`Share a new invite link with ${inv.email}`}
                  onPress={() => void shareAgain(inv)}
                />
                <Button
                  label="Revoke"
                  variant="danger"
                  compact
                  busy={busy}
                  accessibilityLabel={`Revoke the invite to ${inv.email}`}
                  onPress={() => void revoke(inv)}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, marginTop: spacing.sm },
  roles: { gap: spacing.sm },
  roleOption: {
    minHeight: MIN_TOUCH,
    padding: spacing.md,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  roleSelected: { borderColor: colors.primaryLight, backgroundColor: colors.surfaceRaised },
  linkBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.button, backgroundColor: colors.surfaceRaised },
  url: { color: colors.primaryLight },
  pendingTitle: { marginTop: spacing.md },
  list: { gap: spacing.md },
  row: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
});
