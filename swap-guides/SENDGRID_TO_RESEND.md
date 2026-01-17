# Swap Guide: SendGrid → Resend

> Replace SendGrid with Resend for transactional email

## Why Swap?

| SendGrid | Resend |
|----------|--------|
| Complex dashboard | Simple, modern UI |
| Older API design | Modern REST + SDK |
| Email + marketing | Email focused |
| Established | Newer, developer-focused |

Resend is popular with indie hackers for its simplicity and React Email integration.

## Affected Files

### Must Replace

```
packages/backend/src/integrations/
└── email_service.py          # Replace SendGrid with Resend

Environment variables          # New API key
```

### No Change Needed

Everything else — this is a simple 1:1 swap.

---

## Current Pattern (SendGrid)

```python
# packages/backend/src/integrations/email_service.py
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

class EmailService:
    def __init__(self):
        self.client = SendGridAPIClient(settings.SENDGRID_API_KEY)
        self.from_email = settings.SENDGRID_FROM_EMAIL
    
    async def send(
        self,
        to: str,
        subject: str,
        html_content: str,
    ):
        message = Mail(
            from_email=self.from_email,
            to_emails=to,
            subject=subject,
            html_content=html_content,
        )
        
        response = self.client.send(message)
        return response.status_code == 202
```

---

## Replacement Pattern (Resend)

### Install SDK

```bash
pip install resend
```

### Resend Service

```python
# packages/backend/src/integrations/email_service.py
import resend
from src.resilience.circuit_breaker import circuit_breaker
from src.resilience.retry import with_retry

resend.api_key = settings.RESEND_API_KEY


class EmailService:
    """
    Email service using Resend.
    
    Resend is simpler than SendGrid with a modern API.
    """
    
    def __init__(self):
        self.from_email = settings.RESEND_FROM_EMAIL
    
    @circuit_breaker("resend")
    @with_retry(max_attempts=3)
    async def send(
        self,
        to: str | list[str],
        subject: str,
        html: str,
        text: str | None = None,
        reply_to: str | None = None,
        tags: list[dict] | None = None,
    ) -> dict:
        """
        Send an email.
        
        Args:
            to: Recipient email(s)
            subject: Email subject
            html: HTML content
            text: Plain text content (optional)
            reply_to: Reply-to address (optional)
            tags: Tags for tracking (optional)
            
        Returns:
            Resend response with email ID
        """
        params = {
            "from": self.from_email,
            "to": to if isinstance(to, list) else [to],
            "subject": subject,
            "html": html,
        }
        
        if text:
            params["text"] = text
        if reply_to:
            params["reply_to"] = reply_to
        if tags:
            params["tags"] = tags
        
        response = resend.Emails.send(params)
        
        logger.info(
            "email_sent",
            to=to,
            subject=subject,
            email_id=response.get("id"),
        )
        
        return response
    
    async def send_template(
        self,
        to: str,
        template: str,
        data: dict,
    ) -> dict:
        """
        Send email using a template.
        
        Templates are defined in TEMPLATES dict below.
        """
        if template not in TEMPLATES:
            raise ValueError(f"Unknown template: {template}")
        
        template_fn = TEMPLATES[template]
        subject, html = template_fn(data)
        
        return await self.send(to=to, subject=subject, html=html)
    
    async def send_batch(
        self,
        emails: list[dict],
    ) -> list[dict]:
        """
        Send multiple emails.
        
        Args:
            emails: List of email params (to, subject, html)
            
        Returns:
            List of responses
        """
        results = []
        for email in emails:
            result = await self.send(**email)
            results.append(result)
        return results


# Email templates
def welcome_template(data: dict) -> tuple[str, str]:
    name = data.get("name", "there")
    return (
        "Welcome to Our App!",
        f"""
        <h1>Welcome, {name}!</h1>
        <p>Thanks for signing up. We're excited to have you.</p>
        <p>Get started by exploring your dashboard.</p>
        """
    )


def password_reset_template(data: dict) -> tuple[str, str]:
    reset_url = data.get("reset_url", "#")
    return (
        "Reset Your Password",
        f"""
        <h1>Password Reset</h1>
        <p>Click the link below to reset your password:</p>
        <p><a href="{reset_url}">Reset Password</a></p>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request this, ignore this email.</p>
        """
    )


def subscription_confirmed_template(data: dict) -> tuple[str, str]:
    plan = data.get("plan", "Pro")
    return (
        f"Welcome to {plan}!",
        f"""
        <h1>Subscription Confirmed</h1>
        <p>You're now on the {plan} plan.</p>
        <p>Enjoy your new features!</p>
        """
    )


TEMPLATES = {
    "welcome": welcome_template,
    "password_reset": password_reset_template,
    "subscription_confirmed": subscription_confirmed_template,
}


# Global instance
email_service = EmailService()
```

### Using React Email (Optional)

Resend works great with React Email for building templates:

```bash
# Install React Email
pnpm add @react-email/components react-email --filter @project/web
```

```typescript
// apps/web/emails/welcome.tsx
import { Html, Head, Body, Container, Text, Button } from '@react-email/components';

interface WelcomeEmailProps {
  name: string;
}

export default function WelcomeEmail({ name }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif' }}>
        <Container>
          <Text>Welcome, {name}!</Text>
          <Text>Thanks for signing up.</Text>
          <Button href="https://yourapp.com/dashboard">
            Go to Dashboard
          </Button>
        </Container>
      </Body>
    </Html>
  );
}
```

Then render to HTML for the API:

```typescript
import { render } from '@react-email/render';
import WelcomeEmail from '@/emails/welcome';

const html = render(<WelcomeEmail name="John" />);
```

---

## Migration Steps

### 1. Create Resend Account

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain
3. Get API key

### 2. Update Environment Variables

```bash
# Remove
SENDGRID_API_KEY=xxx
SENDGRID_FROM_EMAIL=xxx

# Add
RESEND_API_KEY=re_xxx
RESEND_FROM_EMAIL=hello@yourdomain.com
```

### 3. Install SDK

```bash
pip install resend
```

### 4. Replace Email Service

Replace `packages/backend/src/integrations/email_service.py` with the Resend version above.

### 5. Update Imports

If any file imports from the old service, update:

```python
# No change needed if using:
from src.integrations.email_service import email_service

# The interface is the same
await email_service.send(to=email, subject="Hi", html="<p>Hello</p>")
await email_service.send_template(to=email, template="welcome", data={"name": "John"})
```

### 6. Test

```bash
pytest tests/integrations/test_email_service.py -v
```

---

## Verification Checklist

- [ ] Resend account created
- [ ] Domain verified
- [ ] API key set in environment
- [ ] Email service replaced
- [ ] Test email sends successfully
- [ ] All templates work
- [ ] Circuit breaker wraps calls
- [ ] Tests pass
