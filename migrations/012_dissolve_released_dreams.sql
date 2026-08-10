-- Released dreams are dissolved by contract and must not remain retrievable.
DELETE FROM dream_seeds WHERE status = 'released';
