-- Expand the lead_activity_type enum with new lifecycle event types
-- introduced for comprehensive activity tracking.

alter type lead_activity_type add value if not exists 'status_changed';
alter type lead_activity_type add value if not exists 'follow_up_set';
alter type lead_activity_type add value if not exists 'proposal_sent';
alter type lead_activity_type add value if not exists 'marked_sold';
alter type lead_activity_type add value if not exists 'marked_not_sold';
alter type lead_activity_type add value if not exists 'marked_lost';
alter type lead_activity_type add value if not exists 'marked_pending';
