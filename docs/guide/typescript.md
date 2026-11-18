# TypeScript and integrations

## Sub-path Exports

```typescript
import { pipe }                              from '@mshindi-labs/refetch/pipe';
import { withAuth, withLogging }             from '@mshindi-labs/refetch/middleware';
import { normalizeRetryConfig, shouldRetry } from '@mshindi-labs/refetch/retry';
import { sse, ndjson, parseSse, parseNdjson } from '@mshindi-labs/refetch/stream';
```

## TypeScript Types

```typescript
import type {
  ApiResponse,
  ApiOkResponse,
  ApiErrorResponse,
  RefetchError,
  RetryConfig,
  RefetchConfig,
  RefetchInstance,
  RequestConfig,
  InterceptorManager,
  InterceptorHandler,
  Monitor,
} from '@mshindi-labs/refetch';
```

## Integration with TanStack Query

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { unwrap } from '@mshindi-labs/refetch';

function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => api.get<User>(`/users/${id}`).then(unwrap),
  });
}

function useCreateUser() {
  return useMutation({
    mutationFn: (dto: CreateUserDto) => api.post<User, CreateUserDto>('/users', dto).then(unwrap),
  });
}
```

`unwrap` returns `data` or throws a typed error, so `error` in the query result is a `RefetchResponseError` with `status`, `data` and `kind`; see [Throwing instead of returning](/guide/errors#throwing-instead-of-returning).
