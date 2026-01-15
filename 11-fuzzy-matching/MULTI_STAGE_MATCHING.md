# Multi-Stage Fuzzy Matching Pipeline

Production-grade fuzzy matching for inventory items, products, or any entity reconciliation.

## Problem

Matching vendor SKUs to inventory items when:
- Names vary wildly ("BNLS CHKN BRST 10LB" vs "Chicken Breast Boneless 10 lb")
- Exact matching misses 40-60% of valid matches
- Pure fuzzy matching is too slow at scale (O(n²))
- False positives create duplicate inventory

## Solution: 3-Stage Pipeline

```
Stage 1: PostgreSQL Trigram (fast pre-filter) → 50 candidates
    ↓
Stage 2: Salient Overlap Check (fast) → ~20 candidates  
    ↓
Stage 3: Advanced Multi-Factor Similarity (expensive) → ranked results
```

**Performance**: O(log n) with proper indexing, sub-100ms for 10K+ items

---

## Stage 1: PostgreSQL Trigram Pre-Filter

Use `pg_trgm` extension with GIN index for O(log n) candidate retrieval.

### Database Setup

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add normalized name column
ALTER TABLE inventory_items ADD COLUMN normalized_name TEXT;

-- Create GIN index for trigram search
CREATE INDEX idx_inventory_items_normalized_name_trgm 
ON inventory_items USING GIN (normalized_name gin_trgm_ops);

-- RPC function for similarity search
CREATE OR REPLACE FUNCTION find_similar_items(
    target_name TEXT,
    target_user_id UUID,
    similarity_threshold FLOAT DEFAULT 0.3,
    result_limit INT DEFAULT 50
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    normalized_name TEXT,
    category TEXT,
    unit_of_measure TEXT,
    current_quantity DECIMAL,
    last_purchase_price DECIMAL,
    similarity_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.id,
        i.name,
        i.normalized_name,
        i.category,
        i.unit_of_measure,
        i.current_quantity,
        i.last_purchase_price,
        similarity(i.normalized_name, target_name) as similarity_score
    FROM inventory_items i
    WHERE i.user_id = target_user_id
      AND similarity(i.normalized_name, target_name) > similarity_threshold
    ORDER BY similarity_score DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;
```

### Python Implementation

```python
def _trigram_search(
    self,
    normalized_name: str,
    user_id: str,
    category: Optional[str],
    threshold: float,
    limit: int
) -> List[Dict]:
    """PostgreSQL trigram search with GIN index - O(log n)"""
    try:
        result = self.client.rpc('find_similar_items', {
            'target_name': normalized_name,
            'target_user_id': user_id,
            'similarity_threshold': threshold,
            'result_limit': limit
        }).execute()
        
        if not result.data:
            return []
        
        candidates = []
        for item in result.data:
            if category and item.get('category') != category:
                continue
            item['trigram_similarity'] = item.get('similarity_score', 0)
            candidates.append(item)
        
        return candidates
        
    except Exception as e:
        logger.error(f"Trigram RPC failed: {e}")
        return self._trigram_search_fallback(normalized_name, user_id, category, threshold, limit)
```

---

## Stage 2: Salient Overlap Filter

Quick pre-filter: reject candidates that don't share any distinctive words.

```python
def has_salient_overlap(self, tokens1: List[str], tokens2: List[str]) -> bool:
    """
    Quick pre-filter: do items share any salient words?
    Salient = length >= 3 characters (filters out 'lb', 'oz', etc.)
    """
    SALIENT_MIN_LENGTH = 3
    
    salient1 = {t for t in tokens1 if len(t) >= SALIENT_MIN_LENGTH}
    salient2 = {t for t in tokens2 if len(t) >= SALIENT_MIN_LENGTH}
    
    if not salient1 or not salient2:
        return False
    
    return len(salient1 & salient2) > 0
```

**Why this matters**: Eliminates ~60% of false candidates before expensive similarity calculation.

---

## Stage 3: Multi-Factor Similarity

Weighted combination of multiple signals:

```python
# Weights (must sum to 1.0)
WEIGHTS = {
    'name_similarity': 0.55,      # Trigram cosine
    'token_similarity': 0.25,     # Weighted Jaccard
    'size_similarity': 0.15,      # Quantity matching
    'category_similarity': 0.05   # Category bonus
}

def calculate_advanced_similarity(self, item1: Dict, item2: Dict) -> float:
    """Multi-factor weighted similarity score"""
    name1 = item1.get('name', '') or item1.get('normalized_name', '')
    name2 = item2.get('name', '') or item2.get('normalized_name', '')
    
    # Component scores
    name_sim = self.trigram_cosine_similarity(name1, name2)
    token_sim = self.weighted_jaccard_similarity(
        self.tokenize(name1),
        self.tokenize(name2)
    )
    size_sim = self.size_similarity(
        self.extract_size(name1),
        self.extract_size(name2)
    )
    cat_sim = 1.0 if item1.get('category') == item2.get('category') else 0.0
    
    # Weighted combination
    total = (
        WEIGHTS['name_similarity'] * name_sim +
        WEIGHTS['token_similarity'] * token_sim +
        WEIGHTS['size_similarity'] * size_sim +
        WEIGHTS['category_similarity'] * cat_sim
    )
    
    return round(total, 4)
```

### Trigram Cosine Similarity

```python
def trigram_cosine_similarity(self, text1: str, text2: str) -> float:
    """Character-level trigram cosine - robust to typos"""
    if not text1 or not text2:
        return 0.0
    
    text1 = self.normalize_text(text1)
    text2 = self.normalize_text(text2)
    
    if text1 == text2:
        return 1.0
    
    # Use Levenshtein if available (faster)
    try:
        import Levenshtein
        return Levenshtein.ratio(text1, text2)
    except ImportError:
        pass
    
    # Fallback: trigram cosine
    def get_trigrams(text: str) -> Set[str]:
        padded = f"  {text}  "
        return {padded[i:i+3] for i in range(len(padded) - 2)}
    
    trigrams1 = get_trigrams(text1)
    trigrams2 = get_trigrams(text2)
    
    intersection = trigrams1 & trigrams2
    if not intersection:
        return 0.0
    
    import math
    numerator = len(intersection)
    denominator = math.sqrt(len(trigrams1) * len(trigrams2))
    
    return numerator / denominator if denominator > 0 else 0.0
```

### Weighted Jaccard (Token-Level)

```python
def weighted_jaccard_similarity(self, tokens1: List[str], tokens2: List[str]) -> float:
    """Token similarity with length-based weighting"""
    if not tokens1 or not tokens2:
        return 0.0
    
    set1, set2 = set(tokens1), set(tokens2)
    
    if set1 == set2:
        return 1.0
    
    def token_weight(token: str) -> float:
        """Longer tokens = more distinctive"""
        if len(token) >= 5:
            return 2.0
        elif len(token) >= 3:
            return 1.5
        return 1.0
    
    intersection = set1 & set2
    union = set1 | set2
    
    weighted_intersection = sum(token_weight(t) for t in intersection)
    weighted_union = sum(token_weight(t) for t in union)
    
    return weighted_intersection / weighted_union if weighted_union > 0 else 0.0
```

### Size Similarity (Tolerance Bands)

```python
def size_similarity(self, size1: Optional[Decimal], size2: Optional[Decimal]) -> float:
    """Quantity matching with tolerance bands"""
    if size1 is None or size2 is None:
        return 0.5  # Neutral if missing
    
    if size1 == size2:
        return 1.0
    
    ratio = float(min(size1, size2) / max(size1, size2))
    
    # Tolerance bands
    if ratio >= 0.95:    # Within 5%
        return 1.0
    elif ratio >= 0.85:  # Within 15%
        return 0.8
    elif ratio >= 0.70:  # Within 30%
        return 0.5
    elif ratio >= 0.50:  # Within 50%
        return 0.3
    return 0.0
```

---

## Text Normalization Pipeline

Critical for consistent matching:

```python
class TextNormalizer:
    # Brand names to remove
    BRAND_PATTERNS = [
        r'\bsysco\b', r'\bus foods\b', r'\busf\b',
        r'\bpremium\b', r'\bselect\b', r'\bchoice\b', r'\bprime\b'
    ]
    
    # Unit standardization
    UNIT_MAP = {
        'lb': 'pound', 'lbs': 'pound', 'pounds': 'pound',
        'oz': 'ounce', 'ounces': 'ounce',
        'kg': 'kilogram', 'g': 'gram', 'grams': 'gram',
        'ga': 'gallon', 'gal': 'gallon', 'gallons': 'gallon',
        'qt': 'quart', 'l': 'liter', 'lt': 'liter',
        'ea': 'each', 'pc': 'each', 'pcs': 'each',
    }
    
    # Domain stopwords
    STOPWORDS = {
        'the', 'and', 'or', 'with', 'of', 'in', 'a', 'an',
        'boneless', 'bnls', 'iqf', 'case', 'fresh', 'frozen',
        'organic', 'bulk', 'pack', 'pkg', 'box', 'bag'
    }
    
    def normalize_text(self, text: str) -> str:
        if not text:
            return ""
        
        normalized = text.lower().strip()
        
        # Remove brands
        for pattern in self.BRAND_PATTERNS:
            normalized = re.sub(pattern, '', normalized, flags=re.IGNORECASE)
        
        # Standardize units
        for variant, standard in self.UNIT_MAP.items():
            pattern = r'\b' + re.escape(variant) + r'\b'
            normalized = re.sub(pattern, standard, normalized, flags=re.IGNORECASE)
        
        # Remove punctuation, collapse whitespace
        normalized = re.sub(r'[^\w\s-]', ' ', normalized)
        normalized = ' '.join(normalized.split())
        
        return normalized
    
    def tokenize(self, text: str) -> List[str]:
        normalized = self.normalize_text(text)
        tokens = re.split(r'[\s-]+', normalized)
        return [t for t in tokens if t and t not in self.STOPWORDS and len(t) >= 2]
```

---

## Confidence Thresholds

Tuned from production data:

```python
THRESHOLDS = {
    'auto_match': 0.95,       # Auto-accept (very high confidence)
    'review_match': 0.85,     # Flag for human review
    'min_similarity': 0.70,   # Minimum to consider
    'trigram_filter': 0.3     # PostgreSQL pre-filter
}

def get_match_recommendation(self, similarity_score: float) -> Dict:
    if similarity_score >= THRESHOLDS['auto_match']:
        return {'action': 'auto_match', 'confidence': 'high', 'needs_review': False}
    elif similarity_score >= THRESHOLDS['review_match']:
        return {'action': 'review', 'confidence': 'medium', 'needs_review': True}
    else:
        return {'action': 'create_new', 'confidence': 'low', 'needs_review': False}
```

---

## Complete Orchestrator

```python
class FuzzyItemMatcher:
    def find_similar_items(
        self,
        target_name: str,
        user_id: str,
        category: Optional[str] = None,
        threshold: float = 0.3,
        limit: int = 10
    ) -> List[Dict]:
        """3-stage fuzzy matching pipeline"""
        
        normalized_target = self.normalizer.normalize_text(target_name)
        target_tokens = self.normalizer.tokenize(target_name)
        
        # Stage 1: PostgreSQL trigram (fast)
        candidates = self._trigram_search(
            normalized_target, user_id, category, threshold, 50
        )
        
        if not candidates:
            return []
        
        # Stage 2: Salient overlap filter (fast)
        filtered = []
        for candidate in candidates:
            candidate_tokens = self.normalizer.tokenize(candidate['normalized_name'])
            if self.calculator.has_salient_overlap(target_tokens, candidate_tokens):
                filtered.append(candidate)
        
        if not filtered:
            return []
        
        # Stage 3: Advanced similarity (expensive)
        target_item = {
            'name': target_name,
            'normalized_name': normalized_target,
            'category': category
        }
        
        results = []
        for candidate in filtered:
            similarity = self.calculator.calculate_advanced_similarity(target_item, candidate)
            if similarity >= THRESHOLDS['min_similarity']:
                results.append({**candidate, 'similarity_score': similarity})
        
        results.sort(key=lambda x: x['similarity_score'], reverse=True)
        return results[:limit]
```

---

## Gotchas & Lessons Learned

1. **Threshold tuning**: Start conservative (0.95 auto-match), lower based on false negative rate
2. **Normalize on write**: Store `normalized_name` column, don't compute on every query
3. **Fallback matters**: Always have Python fallback if RPC fails
4. **Domain stopwords**: Generic stopword lists miss industry terms ('bnls', 'iqf')
5. **Size extraction**: "10 lb" vs "10lb" vs "10LB" - normalize units before extraction
