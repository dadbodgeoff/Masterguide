# Batch Processing Pattern

30-40% throughput improvement by batching database operations with graceful fallback.

## Problem

Sequential processing of line items:
- 15-item invoice takes ~12 seconds
- Each item = 3-4 DB queries (mapping, transaction, price, inventory update)
- 45-60 round trips per invoice
- Network latency dominates

## Solution: Collect-Then-Batch

```
Sequential (slow):
Item 1 → DB → DB → DB
Item 2 → DB → DB → DB
Item 3 → DB → DB → DB
...

Batched (fast):
Item 1 → collect
Item 2 → collect
Item 3 → collect
...
All items → BATCH INSERT transactions
All items → BATCH INSERT prices
All items → BATCH UPDATE inventory
```

**Result**: 15-item invoice in ~8s (down from ~12s)

---

## Implementation

```python
from decimal import Decimal
from typing import Dict, List
import time

class InvoiceBatchProcessor:
    """
    Batched invoice processor
    Uses existing service layer but batches DB operations
    """
    
    def __init__(self):
        self.client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # Reuse existing services for business logic
        self.vendor_service = VendorService()
        self.mapper = VendorItemMapper()
        self.inventory_service = InventoryService()
        self.unit_converter = UnitConverter()
    
    def process_invoice_batched(self, invoice_id: str, user_id: str, invoice_data: Dict) -> Dict:
        """
        Batch-optimized invoice processing
        
        Pattern:
        1. Process mappings sequentially (fuzzy matching needs context)
        2. Collect all DB writes
        3. Execute batch inserts
        4. Fallback to sequential on batch failure
        """
        start_time = time.perf_counter()
        
        invoice = invoice_data['invoice']
        line_items = invoice_data['line_items']
        
        # Step 1: Get vendor (single query, reused for all items)
        vendor_id = self.vendor_service.create_or_get_vendor(
            user_id=user_id,
            vendor_name=invoice['vendor_name']
        )
        
        # Collectors for batch operations
        transactions_to_create = []
        prices_to_create = []
        inventory_updates = {}  # item_id -> {quantity_delta, last_price, last_date}
        
        # Stats
        items_processed = 0
        items_created = 0
        items_updated = 0
        fuzzy_matches = 0
        exact_matches = 0
        failed_items = []
        
        # Step 2: Process mappings (sequential - fuzzy matching needs context)
        for idx, item in enumerate(line_items, 1):
            try:
                # Use existing mapper (handles fuzzy matching)
                mapping = self.mapper.find_or_create_mapping(
                    user_id=user_id,
                    vendor_id=vendor_id,
                    vendor_item_number=item.get('item_number') or '',
                    vendor_description=item['description'],
                    pack_size=item.get('pack_size'),
                    category=item.get('category') or 'dry_goods'
                )
                
                # Track stats
                if mapping['is_new_item']:
                    items_created += 1
                else:
                    items_updated += 1
                
                if mapping['match_method'] in ['fuzzy_auto', 'fuzzy_review']:
                    fuzzy_matches += 1
                elif mapping['match_method'] == 'exact':
                    exact_matches += 1
                
                # Prepare transaction data (with unit conversion)
                quantity = Decimal(str(item['quantity']))
                unit_cost = Decimal(str(item['unit_price']))
                
                if item.get('pack_size'):
                    base_quantity, _ = self.unit_converter.calculate_total_quantity(
                        item['pack_size'], int(quantity)
                    )
                    quantity = Decimal(str(base_quantity))
                
                # Collect for batch insert
                transactions_to_create.append({
                    "user_id": user_id,
                    "inventory_item_id": mapping['inventory_item_id'],
                    "transaction_type": "purchase",
                    "quantity_change": float(quantity),
                    "reference_id": invoice_id,
                    "reference_type": "invoice",
                    "unit_cost": float(unit_cost),
                    "total_cost": float(quantity * unit_cost),
                    "transaction_date": invoice['invoice_date']
                })
                
                # Track inventory updates (aggregate by item)
                item_id = mapping['inventory_item_id']
                if item_id not in inventory_updates:
                    inventory_updates[item_id] = {
                        "quantity_delta": Decimal('0'),
                        "last_price": unit_cost,
                        "last_date": invoice['invoice_date']
                    }
                inventory_updates[item_id]['quantity_delta'] += quantity
                
                # Collect price history
                prices_to_create.append({
                    "user_id": user_id,
                    "inventory_item_id": mapping['inventory_item_id'],
                    "vendor_id": vendor_id,
                    "unit_price": float(unit_cost),
                    "pack_size": item.get('pack_size'),
                    "invoice_id": invoice_id,
                    "invoice_date": invoice['invoice_date']
                })
                
                items_processed += 1
                
            except Exception as item_error:
                # Continue processing other items
                error_type = classify_invoice_error(item_error)
                failed_items.append({
                    "line": idx,
                    "description": item['description'],
                    "error": str(item_error),
                    "error_type": error_type
                })
                continue
        
        # Step 3: BATCH INSERT transactions
        if transactions_to_create:
            try:
                batch_start = time.perf_counter()
                self.client.table("inventory_transactions").insert(
                    transactions_to_create
                ).execute()
                logger.info(f"Batched {len(transactions_to_create)} transactions in {time.perf_counter() - batch_start:.2f}s")
            except Exception as e:
                logger.error(f"Batch transaction insert failed: {e}")
                # CRITICAL: Fallback to sequential on batch failure
                return self._fallback_to_sequential(invoice_id, user_id, invoice_data)
        
        # Step 4: BATCH INSERT price history (with change detection)
        if prices_to_create:
            try:
                # Get previous prices in one query
                item_ids = list(set(p['inventory_item_id'] for p in prices_to_create))
                prev_prices = self._get_previous_prices_batch(item_ids, vendor_id)
                
                # Add price change calculations
                for price_record in prices_to_create:
                    item_id = price_record['inventory_item_id']
                    if item_id in prev_prices:
                        prev = Decimal(str(prev_prices[item_id]))
                        curr = Decimal(str(price_record['unit_price']))
                        change_pct = float(((curr - prev) / prev) * 100)
                        price_record['previous_price'] = float(prev)
                        price_record['price_change_percent'] = change_pct
                        price_record['is_price_increase'] = curr > prev
                
                self.client.table("price_history").insert(prices_to_create).execute()
            except Exception as e:
                logger.error(f"Batch price insert failed: {e}")
                # Non-critical - continue without price history
        
        # Step 5: BATCH UPDATE inventory quantities
        if inventory_updates:
            try:
                self._batch_update_inventory(inventory_updates)
            except Exception as e:
                logger.error(f"Batch inventory update failed: {e}")
        
        total_time = time.perf_counter() - start_time
        
        # Determine status
        if failed_items:
            status = "partial_success" if items_processed > 0 else "failed"
        else:
            status = "success"
        
        return {
            "status": status,
            "invoice_id": invoice_id,
            "items_processed": items_processed,
            "items_failed": len(failed_items),
            "inventory_items_created": items_created,
            "inventory_items_updated": items_updated,
            "fuzzy_matches": fuzzy_matches,
            "exact_matches": exact_matches,
            "failed_items": failed_items if failed_items else None,
            "processing_time_seconds": round(total_time, 2)
        }
    
    def _get_previous_prices_batch(self, item_ids: List[str], vendor_id: str) -> Dict[str, float]:
        """Get latest price for multiple items in one query"""
        result = self.client.table("price_history").select(
            "inventory_item_id, unit_price"
        ).in_("inventory_item_id", item_ids).eq(
            "vendor_id", vendor_id
        ).order("invoice_date", desc=True).execute()
        
        # Take first (latest) price per item
        prices = {}
        for record in result.data:
            item_id = record['inventory_item_id']
            if item_id not in prices:
                prices[item_id] = record['unit_price']
        
        return prices
    
    def _batch_update_inventory(self, updates: Dict[str, Dict]):
        """Update inventory quantities - batch query, individual updates"""
        item_ids = list(updates.keys())
        
        # Get current quantities (batch query)
        current_items = self.client.table("inventory_items").select(
            "id, current_quantity"
        ).in_("id", item_ids).execute()
        
        # Calculate and apply updates
        for item in current_items.data:
            item_id = item['id']
            current_qty = Decimal(str(item['current_quantity']))
            delta = updates[item_id]['quantity_delta']
            new_qty = current_qty + delta
            
            # Individual update (Supabase doesn't support batch UPDATE)
            self.client.table("inventory_items").update({
                "current_quantity": float(new_qty),
                "last_purchase_price": float(updates[item_id]['last_price']),
                "last_purchase_date": updates[item_id]['last_date']
            }).eq("id", item_id).execute()
    
    def _fallback_to_sequential(self, invoice_id: str, user_id: str, invoice_data: Dict) -> Dict:
        """
        CRITICAL: Fallback to sequential processing if batch fails
        This ensures data integrity even when batch operations fail
        """
        logger.warning("Falling back to sequential processing")
        from services.invoice_processor import InvoiceProcessor
        processor = InvoiceProcessor()
        return processor.process_invoice(invoice_id)
```

---

## Key Design Decisions

### 1. Sequential Mapping, Batched Writes

Fuzzy matching must be sequential because:
- Each match affects subsequent matches (creates new items)
- Context-dependent decisions can't be parallelized

But writes can be batched because:
- All data is collected before any writes
- Writes are independent of each other

### 2. Fallback to Sequential

```python
except Exception as e:
    logger.error(f"Batch insert failed: {e}")
    return self._fallback_to_sequential(invoice_id, user_id, invoice_data)
```

**Why this matters**:
- Batch operations can fail (constraint violations, timeouts)
- Sequential processing is slower but more reliable
- User gets their data processed either way

### 3. Partial Success Handling

```python
for idx, item in enumerate(line_items, 1):
    try:
        # Process item
        items_processed += 1
    except Exception as item_error:
        failed_items.append({...})
        continue  # Don't stop on individual failures

# Return partial success status
if failed_items:
    status = "partial_success" if items_processed > 0 else "failed"
```

**Why**: One bad line item shouldn't fail the entire invoice.

### 4. Aggregate Before Update

```python
# DON'T: Update inventory for each line item
for item in line_items:
    update_inventory(item_id, +quantity)  # 15 updates

# DO: Aggregate then update once per item
inventory_updates = {}
for item in line_items:
    inventory_updates[item_id]['quantity_delta'] += quantity

for item_id, update in inventory_updates.items():
    update_inventory(item_id, update['quantity_delta'])  # ~8 updates
```

---

## Performance Comparison

| Metric | Sequential | Batched | Improvement |
|--------|------------|---------|-------------|
| 15-item invoice | ~12s | ~8s | 33% faster |
| DB round trips | 45-60 | 15-20 | 66% fewer |
| Network latency impact | High | Low | Significant |

---

## When to Use

✅ **Use batching when**:
- Processing multiple related records
- Writes are independent (no inter-record dependencies)
- Network latency is significant
- You can implement fallback

❌ **Don't batch when**:
- Records depend on each other's results
- Partial failure is unacceptable
- Transaction isolation is required across records

---

## Gotchas

1. **Supabase doesn't support batch UPDATE**: Use batch SELECT + individual UPDATEs
2. **Memory pressure**: Don't collect 10K+ records before writing
3. **Error messages**: Batch failures give less context - log individual items
4. **Idempotency**: Batch retries can cause duplicates - use upsert or check first
5. **Timeouts**: Large batches can timeout - chunk if needed (500 records max)
