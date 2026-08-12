MATCH (r:Risk) WHERE r.level IN ['high','critical'] RETURN r;
