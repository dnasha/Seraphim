import React, { lazy, Suspense, type ComponentType } from 'react';

/** Fixture equivalent of client-only next/dynamic; imports the real components. */
export default function dynamic<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
    const Component = lazy(loader);
    return function FixtureDynamic(props: P) {
        return <Suspense fallback={null}><Component {...props} /></Suspense>;
    };
}
