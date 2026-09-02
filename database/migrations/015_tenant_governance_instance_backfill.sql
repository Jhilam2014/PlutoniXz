-- Materialize tenant instance boundaries for memberships that predate tenant
-- governance. PostgreSQL's built-in sha256 function matches the Node service's
-- deterministic instance-key derivation.
INSERT INTO tenant_instances (tenant_id, instance_key)
SELECT memberships.tenant_id,
       'tenant-' || substring(encode(sha256(convert_to(memberships.tenant_id, 'UTF8')), 'hex') FROM 1 FOR 16)
  FROM (
    SELECT DISTINCT tenant_id
      FROM identity_tenant_memberships
     WHERE length(trim(tenant_id)) BETWEEN 1 AND 160
  ) AS memberships
ON CONFLICT (tenant_id) DO NOTHING;
