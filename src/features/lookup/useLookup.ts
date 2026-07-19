import { useEffect, useState } from 'react';
import { lookupWord, type Lookups } from '@shared/lookup';

/**
 * Dictionary lookup state for a term. Call `lookup(term)` to (re)query ANW +
 * Wiktionary; `lookups` is null while loading, then the results. Shared by the
 * Add screen and the card edit forms.
 */
export function useLookup() {
  const [term, setTerm] = useState('');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  useEffect(() => {
    if (!term) {
      setLookups(null);
      return;
    }
    let cancelled = false;
    setLookups(null);
    void lookupWord(term).then((l) => {
      if (!cancelled) setLookups(l);
    });
    return () => {
      cancelled = true;
    };
  }, [term]);
  return { term, lookups, lookup: setTerm };
}
