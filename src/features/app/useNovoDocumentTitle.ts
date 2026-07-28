"use client";

import { useEffect } from "react";
import { useNovoBrand } from "@/components/NovoInstanceProvider";
import { getNovoDocumentTitle } from "@/lib/documentTitle";

export function useNovoDocumentTitle(pageTitle: string | null) {
  const { wordmark } = useNovoBrand();

  useEffect(() => {
    document.title = getNovoDocumentTitle(wordmark, pageTitle);

    return () => {
      document.title = wordmark;
    };
  }, [pageTitle, wordmark]);
}
