import { FeedbackBoard } from '@/components/feedback/FeedbackBoard';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';

// AD-016: top-level error boundary so a single render exception in any
// descendant doesn't take the whole app down to a white screen. Modal-
// scoped boundaries inside FeedbackBoard catch finer-grained crashes so a
// blown-up modal still leaves the kanban board usable.
export default function Home() {
  return (
    <ErrorBoundary label="the board">
      <FeedbackBoard />
    </ErrorBoundary>
  );
}
