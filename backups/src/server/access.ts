import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'

// Better Auth's own organization permissions (members, invitations, the org record).
// App-level permissions live in ~/lib/permissions.
export const ac = createAccessControl(defaultStatements)

export const roles = {
  owner: ac.newRole({
    organization: ['update', 'delete'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    team: [],
    ac: [],
  }),
  admin: ac.newRole({ organization: ['update'], member: [], invitation: [], team: [], ac: [] }),
  operator: ac.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] }),
  viewer: ac.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] }),
}
