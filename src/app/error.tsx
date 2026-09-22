'use client';

import { useEffect, useTransition } from 'react';

import StateNotice from '@/components/ui/StateNotice';

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Global Error Caught:", error);
  }, [error]);

  return (
    <StateNotice
      placement="page"
      variant="error"
      title="Something went wrong"
      message="This view couldn’t be loaded. Please try again."
      actionLabel="Try again"
      actionTitle="Retry loading this page"
      actionPending={isPending}
      onAction={() => startTransition(retry)}
    />
  );
}
