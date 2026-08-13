/**
 * v1 is a single-user local tool, so this returns a fixed id.
 * Every table already carries user_id, so adding real auth later means
 * replacing the body of this function and nothing else.
 */
export const LOCAL_USER_ID = 'local-user';

export function getCurrentUser(_request: Request): string {
  return LOCAL_USER_ID;
}
