# Email Service Pattern

> SendGrid integration with daily caps, per-user rate limiting, and graceful degradation.

**Time to implement**: 4 hours  
**Complexity**: Medium  
**Dependencies**: SendGrid API, Supabase

## The Problem

Email notifications seem simple until you need:
- Daily caps per user (prevent spam)
- Graceful degradation when email service is down
- Batch processing with individual tracking
- Configuration validation before sending

## Core Implementation

```typescript
// services/email-sender.ts

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'alerts@yourapp.com';
const MAX_ALERTS_PER_DAY = 10;

interface SendResult {
  success: boolean;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Check if email sending is configured
 * Always check before attempting to send
 */
export function isEmailConfigured(): boolean {
  return !!(SENDGRID_API_KEY && SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

/**
 * Send email via SendGrid API
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.warn('[EmailSender] SendGrid API key not configured');
    return false;
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDGRID_FROM_EMAIL, name: 'Your App Alerts' },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[EmailSender] SendGrid error: ${response.status} - ${error}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[EmailSender] Failed to send email:', error);
    return false;
  }
}
```

## Per-User Daily Caps

```typescript
interface UserPreferenceWithEmail {
  id: string;
  user_id: string;
  email: string;
  threshold: number;
  regions: string[];
  email_enabled: boolean;
  alerts_today: number;
  last_alert_at: string | null;
}

/**
 * Fetch preferences with daily cap reset logic
 */
async function fetchActivePreferences(): Promise<UserPreferenceWithEmail[]> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('alert_preferences')
    .select(`id, user_id, threshold, regions, email_enabled, alerts_today, last_alert_at`)
    .eq('email_enabled', true);

  if (error || !data) return [];

  // Fetch emails from auth.users (requires service role)
  const { data: users } = await supabase.auth.admin.listUsers();
  const emailMap = new Map(users?.users.map(u => [u.id, u.email]) || []);

  // Reset alerts_today if new day
  return data
    .filter(p => emailMap.has(p.user_id))
    .map(p => {
      const lastAlertDate = p.last_alert_at?.split('T')[0];
      const alertsToday = lastAlertDate === today ? (p.alerts_today || 0) : 0;

      return {
        ...p,
        email: emailMap.get(p.user_id)!,
        alerts_today: alertsToday,
      };
    })
    .filter(p => p.alerts_today < MAX_ALERTS_PER_DAY);
}

/**
 * Update user's alert count after sending
 */
async function updateAlertCount(userId: string, newCount: number): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  await supabase
    .from('alert_preferences')
    .update({
      alerts_today: newCount,
      last_alert_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}
```

## Batch Send with Tracking

```typescript
/**
 * Send alerts to all eligible users
 */
export async function sendUserAlerts(predictions: Prediction[]): Promise<SendResult> {
  const result: SendResult = {
    success: true,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Graceful degradation: skip if not configured
  if (!isEmailConfigured()) {
    console.log('[EmailSender] Email sending disabled (not configured)');
    return { ...result, skipped: predictions.length };
  }

  const preferences = await fetchActivePreferences();
  if (preferences.length === 0) return result;

  // Generate alerts based on user preferences
  const alerts = processAlertsForPredictions(predictions, preferences);
  if (alerts.length === 0) return result;

  // Group alerts by user to respect daily limits
  const alertsByUser = new Map<string, QueuedAlert[]>();
  for (const alert of alerts) {
    const existing = alertsByUser.get(alert.user_id) || [];
    alertsByUser.set(alert.user_id, [...existing, alert]);
  }

  // Send alerts respecting per-user caps
  for (const [userId, userAlerts] of alertsByUser) {
    const pref = preferences.find(p => p.user_id === userId);
    if (!pref) continue;

    const remaining = MAX_ALERTS_PER_DAY - pref.alerts_today;
    const toSend = userAlerts.slice(0, remaining);

    let sentCount = 0;
    for (const alert of toSend) {
      const { subject, html, text } = formatAlertEmail(alert);
      const success = await sendEmail(pref.email, subject, html, text);

      if (success) {
        result.sent++;
        sentCount++;
      } else {
        result.failed++;
        result.errors.push(`Failed to send to ${pref.email}`);
      }
    }

    // Update alert count
    if (sentCount > 0) {
      await updateAlertCount(userId, pref.alerts_today + sentCount);
    }

    // Track skipped due to daily cap
    result.skipped += userAlerts.length - toSend.length;
  }

  result.success = result.failed === 0;
  return result;
}
```

## Database Schema

```sql
-- alert_preferences table
CREATE TABLE alert_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  threshold INTEGER DEFAULT 70,
  regions TEXT[] DEFAULT '{}',
  email_enabled BOOLEAN DEFAULT true,
  alerts_today INTEGER DEFAULT 0,
  last_alert_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- RLS policies
ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own preferences"
  ON alert_preferences FOR ALL
  USING (auth.uid() = user_id);
```

## Test Email Function

```typescript
/**
 * Test email configuration
 */
export async function sendTestEmail(to: string): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.error('[EmailSender] Cannot send test email - not configured');
    return false;
  }

  return sendEmail(
    to,
    '🧪 Alert Test',
    `<div style="font-family: system-ui; padding: 20px;">
      <h1>✅ Email Configuration Working</h1>
      <p>Your alert emails are configured correctly.</p>
    </div>`,
    'Alert Test\n\nYour email configuration is working correctly.'
  );
}
```

## Key Patterns

1. **Configuration Check First** - Always verify `isEmailConfigured()` before attempting sends
2. **Daily Cap Reset** - Compare `last_alert_at` date to today, reset counter if different
3. **Per-User Limits** - Slice alerts to remaining quota before sending
4. **Batch Tracking** - Return detailed results (sent/failed/skipped) for monitoring
5. **Graceful Degradation** - Return skipped count instead of throwing when unconfigured

## Environment Variables

```bash
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=alerts@yourapp.com
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## Anti-Patterns to Avoid

- ❌ Sending without checking configuration
- ❌ No daily limits (users get spammed)
- ❌ Throwing errors when email service is down
- ❌ Not tracking sent/failed counts
- ❌ Hardcoding email addresses
