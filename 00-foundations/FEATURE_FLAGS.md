# Feature Flags for Safe Deployment

Environment-based feature control with phased rollout and instant rollback.

## Problem

Deploying new features is risky:
- Big bang releases cause big bang failures
- Can't test with real users safely
- Rollback requires code deployment
- No way to enable for specific users first

## Solution: Environment-Based Feature Flags

```
Deploy code with features OFF
    ↓
Enable for yourself (beta)
    ↓
Enable for beta users
    ↓
Enable for all users
    ↓
If problems: instant disable via env var
```

---

## Implementation

```python
import os
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


class FeatureFlags:
    """
    Centralized feature flag management
    
    Environment variables control which features are enabled:
    - ENABLE_MENU_ANALYSIS=true/false
    - ENABLE_MENU_PREMIUM=true/false
    - MENU_BETA_USERS=user-id-1,user-id-2
    """
    
    def __init__(self):
        self._flags = self._load_flags_from_env()
        self._log_flag_status()
    
    def _load_flags_from_env(self) -> Dict[str, bool]:
        """Load feature flags from environment variables"""
        return {
            # Core feature
            'menu_analysis': self._env_bool('ENABLE_MENU_ANALYSIS', False),
            
            # Sub-features
            'menu_extraction': self._env_bool('ENABLE_MENU_EXTRACTION', False),
            'menu_premium': self._env_bool('ENABLE_MENU_PREMIUM', False),
            
            # Infrastructure
            'menu_api_routes': self._env_bool('ENABLE_MENU_API_ROUTES', False),
            'menu_frontend': self._env_bool('ENABLE_MENU_FRONTEND', False),
            
            # Rollout control
            'menu_beta_users': self._env_bool('ENABLE_MENU_BETA_USERS', False),
            
            # Optimization flags
            'use_parallel_processing': self._env_bool('USE_PARALLEL_PROCESSING', False),
            'use_caching': self._env_bool('USE_CACHING', False),
        }
    
    def _env_bool(self, key: str, default: bool = False) -> bool:
        """Convert environment variable to boolean"""
        value = os.getenv(key, str(default)).lower()
        return value in ('true', '1', 'yes', 'on', 'enabled')
    
    def _log_flag_status(self):
        """Log current feature flag status on startup"""
        logger.info("Feature flags loaded:")
        for flag_name, enabled in self._flags.items():
            status = "ENABLED" if enabled else "DISABLED"
            logger.info(f"  • {flag_name}: {status}")
    
    # =========================================================================
    # FEATURE CHECKS
    # =========================================================================
    
    def is_menu_analysis_enabled(self) -> bool:
        return self._flags.get('menu_analysis', False)
    
    def is_menu_premium_enabled(self) -> bool:
        return self._flags.get('menu_premium', False)
    
    def is_menu_api_enabled(self) -> bool:
        return self._flags.get('menu_api_routes', False)
    
    # =========================================================================
    # USER-SPECIFIC CHECKS
    # =========================================================================
    
    def is_enabled_for_user(self, feature: str, user_id: str) -> bool:
        """
        Check if feature is enabled for specific user
        Allows gradual rollout to specific users first
        """
        # If feature is globally disabled, return False
        if not self._flags.get(feature, False):
            return False
        
        # If beta mode is enabled, check beta user list
        if self._flags.get(f'{feature}_beta_users', False):
            return self._is_beta_user(user_id)
        
        # If not in beta mode, enabled for all users
        return True
    
    def _is_beta_user(self, user_id: str) -> bool:
        """Check if user is in beta test group"""
        beta_users_str = os.getenv('BETA_USERS', '')
        beta_users = [u.strip() for u in beta_users_str.split(',') if u.strip()]
        return user_id in beta_users
    
    # =========================================================================
    # TIER-SPECIFIC CHECKS
    # =========================================================================
    
    def is_tier_enabled(self, feature: str, tier: str) -> bool:
        """Check if feature is enabled for subscription tier"""
        if tier == 'free':
            return self._flags.get(feature, False)
        elif tier == 'premium':
            return self._flags.get(feature, False) and self._flags.get(f'{feature}_premium', True)
        elif tier == 'enterprise':
            return True  # Enterprise gets everything
        return False
    
    # =========================================================================
    # DEBUGGING
    # =========================================================================
    
    def get_all_flags(self) -> Dict[str, bool]:
        """Get all flags for debugging/admin panel"""
        return self._flags.copy()
    
    def get_feature_status(self, feature: str) -> Dict[str, Any]:
        """Get comprehensive status for a feature"""
        return {
            'enabled': self._flags.get(feature, False),
            'beta_mode': self._flags.get(f'{feature}_beta_users', False),
            'premium_only': self._flags.get(f'{feature}_premium', False),
            'env_var': f'ENABLE_{feature.upper()}',
            'current_value': os.getenv(f'ENABLE_{feature.upper()}', 'not set'),
        }


# Global instance
feature_flags = FeatureFlags()


# =========================================================================
# CONVENIENCE FUNCTIONS
# =========================================================================

def is_feature_enabled(feature: str) -> bool:
    """Quick check if feature is enabled"""
    return feature_flags._flags.get(feature, False)


def is_feature_enabled_for_user(feature: str, user_id: str) -> bool:
    """Quick check if feature is enabled for user"""
    return feature_flags.is_enabled_for_user(feature, user_id)


def require_feature(feature: str):
    """Raise error if feature is disabled"""
    if not is_feature_enabled(feature):
        raise RuntimeError(f"Feature '{feature}' is disabled")
```

---

## Deployment Configurations

Pre-defined configurations for different deployment phases:

```python
class DeploymentConfig:
    """Predefined deployment configurations"""
    
    @staticmethod
    def production_safe() -> Dict[str, str]:
        """Production deployment with all new features OFF"""
        return {
            'ENABLE_MENU_ANALYSIS': 'false',
            'ENABLE_MENU_EXTRACTION': 'false',
            'ENABLE_MENU_PREMIUM': 'false',
            'ENABLE_MENU_API_ROUTES': 'false',
            'ENABLE_MENU_FRONTEND': 'false',
            'ENABLE_MENU_BETA_USERS': 'false',
        }
    
    @staticmethod
    def beta_testing() -> Dict[str, str]:
        """Beta testing - enabled for specific users only"""
        return {
            'ENABLE_MENU_ANALYSIS': 'true',
            'ENABLE_MENU_EXTRACTION': 'false',  # Start without risky features
            'ENABLE_MENU_PREMIUM': 'false',
            'ENABLE_MENU_API_ROUTES': 'true',
            'ENABLE_MENU_FRONTEND': 'true',
            'ENABLE_MENU_BETA_USERS': 'true',
            'BETA_USERS': 'your-user-id,tester-user-id',
        }
    
    @staticmethod
    def limited_release() -> Dict[str, str]:
        """Limited release - all users, basic features"""
        return {
            'ENABLE_MENU_ANALYSIS': 'true',
            'ENABLE_MENU_EXTRACTION': 'false',
            'ENABLE_MENU_PREMIUM': 'false',
            'ENABLE_MENU_API_ROUTES': 'true',
            'ENABLE_MENU_FRONTEND': 'true',
            'ENABLE_MENU_BETA_USERS': 'false',
        }
    
    @staticmethod
    def full_release() -> Dict[str, str]:
        """Full release - all features enabled"""
        return {
            'ENABLE_MENU_ANALYSIS': 'true',
            'ENABLE_MENU_EXTRACTION': 'true',
            'ENABLE_MENU_PREMIUM': 'true',
            'ENABLE_MENU_API_ROUTES': 'true',
            'ENABLE_MENU_FRONTEND': 'true',
            'ENABLE_MENU_BETA_USERS': 'false',
        }
```

---

## Usage in Routes

```python
from config.feature_flags import feature_flags, require_feature

@router.post("/menu/analyze")
async def analyze_menu(
    auth: AuthenticatedUser = Depends(get_current_membership),
):
    # Check if feature is enabled for this user
    if not feature_flags.is_enabled_for_user('menu_analysis', auth.id):
        raise HTTPException(
            status_code=403,
            detail="Menu analysis is not available for your account"
        )
    
    # ... implementation


@router.get("/menu/premium-insights")
async def get_premium_insights(
    auth: AuthenticatedUser = Depends(get_current_membership),
):
    # Check tier-specific access
    if not feature_flags.is_tier_enabled('menu_analysis', auth.subscription_tier):
        raise HTTPException(
            status_code=403,
            detail="Premium insights require a premium subscription"
        )
    
    # ... implementation
```

---

## Usage in Services

```python
class MenuAnalysisService:
    def analyze(self, menu_data: Dict) -> Dict:
        result = self._basic_analysis(menu_data)
        
        # Conditionally add premium features
        if feature_flags.is_menu_premium_enabled():
            result['competitor_comparison'] = self._competitor_analysis(menu_data)
            result['price_optimization'] = self._price_suggestions(menu_data)
        
        # Conditionally use optimizations
        if feature_flags._flags.get('use_parallel_processing', False):
            result['insights'] = self._parallel_insights(menu_data)
        else:
            result['insights'] = self._sequential_insights(menu_data)
        
        return result
```

---

## Deployment Phases

```bash
# Phase 1: Deploy Code (Features OFF)
export ENABLE_MENU_ANALYSIS=false
# Deploy and verify existing features still work

# Phase 2: Self-Testing
export ENABLE_MENU_ANALYSIS=true
export ENABLE_MENU_BETA_USERS=true
export BETA_USERS="your-user-id"
# Test with yourself only

# Phase 3: Beta Testing
export BETA_USERS="your-user-id,tester1,tester2"
# Expand to trusted testers

# Phase 4: Limited Release
export ENABLE_MENU_BETA_USERS=false
# Enable for all users, basic features only

# Phase 5: Full Release
export ENABLE_MENU_PREMIUM=true
export ENABLE_MENU_EXTRACTION=true
# All features enabled

# EMERGENCY ROLLBACK (instant, no deploy needed)
export ENABLE_MENU_ANALYSIS=false
# Instantly disables all menu features
```

---

## Admin Endpoint

```python
@router.get("/admin/feature-flags")
async def get_feature_flags(
    auth: AuthenticatedUser = Depends(require_admin),
):
    """Admin endpoint to view feature flag status"""
    return {
        "flags": feature_flags.get_all_flags(),
        "environment": os.getenv("ENVIRONMENT", "unknown"),
        "beta_users": os.getenv("BETA_USERS", "").split(","),
    }
```

---

## Gotchas

1. **Default to OFF**: New features should default to `False` - explicit enable is safer
2. **Log on startup**: Always log flag status so you know what's enabled
3. **Cache flag reads**: Don't read env vars on every request (load once on startup)
4. **Test both states**: Your tests should cover feature ON and OFF
5. **Clean up old flags**: Remove flags after feature is stable (tech debt)
6. **Document flag dependencies**: If feature B requires feature A, document it
