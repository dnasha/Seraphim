'use client';

import { useEffect } from 'react';

import StateNotice from '@/components/ui/StateNotice';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Global Error Caught:", error);
  }, [error]);

  return (
    <StateNotice
      placement="page"
      variant="error"
      title="Something went wrong"
      message="This view couldn’t be loaded. Your data is safe, and you can try again."
      actionLabel="Try again"
      actionTitle="Retry rendering this page"
      onAction={reset}
    />
  );
}
