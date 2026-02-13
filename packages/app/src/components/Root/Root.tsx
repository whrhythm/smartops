import { PropsWithChildren, useContext } from 'react';

import { Sidebar, SidebarPage } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';

import { policyEntityCreatePermission } from '@backstage-community/plugin-rbac-common';
import Box from '@mui/material/Box';
import { styled, Theme } from '@mui/material/styles';
import { ThemeConfig } from '@red-hat-developer-hub/backstage-plugin-theme';
import DynamicRootContext, { ResolvedMenuItem } from '@red-hat-developer-hub/plugin-utils';

import { useLanguagePreference } from '../../hooks/useLanguagePreference';
import { useTranslation } from '../../hooks/useTranslation';
import OpsPilotSidebar from './OpsPilotSidebar';

/**
 * This is a workaround to remove the fix height of the Page component
 * to support the application headers (and the global header plugin)
 * without having multiple scrollbars.
 *
 * Note that we cannot target class names directly, due to obfuscation in production builds.
 *
 * This solves also the duplicate scrollbar issues in tech docs:
 * https://issues.redhat.com/browse/RHIDP-4637 (Scrollbar for docs behaves weirdly if there are over a page of headings)
 *
 * Which was also reported and tried to fix upstream:
 * https://github.com/backstage/backstage/issues/13717
 * https://github.com/backstage/backstage/pull/14138
 * https://github.com/backstage/backstage/issues/19427
 * https://github.com/backstage/backstage/issues/22745
 *
 * See also
 * https://github.com/backstage/backstage/blob/v1.35.0/packages/core-components/src/layout/Page/Page.tsx#L31-L34
 *
 * The following rules are based on the current DOM structure
 *
 * ```
 * <body>
 *   <div id="root">
 *     // snackbars and toasts
 *     <div className="pageWithoutFixHeight">
 *       <nav />                               // Optional nav(s) if a header with position: above-sidebar is configured
 *       <div>                                 // Backstage SidebarPage component
 *         <nav />                             // Optional nav(s) if a header with position: above-main-content is configured
 *         <nav aria-label="sidebar nav" />    // Sidebar content
 *         <main />                            // Backstage Page component
 *       </div>
 *     </div>
 *   </div>
 *   // some modals and other overlays
 * </body>
 * ```
 */
// this component is copied to rhdh-plugins/global-header packages/app/src/components/Root/Root.tsx and should be kept in sync
const PageWithoutFixHeight = styled(Box, {
  name: 'RHDHPageWithoutFixHeight',
  slot: 'root',
})(() => ({
  // Use the complete viewport (similar to how Backstage does it) and make the
  // page content part scrollable below. We also need to compensate for the
  // above-sidebar position of the global header as it takes up a fixed height
  // at the top of the page.
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',

  // This solves the same issue for techdocs, which was reported as
  // https://issues.redhat.com/browse/RHIDP-4637
  '.techdocs-reader-page > main': {
    height: 'unset',
  },
}));

// this component is copied to rhdh-plugins/global-header packages/app/src/components/Root/Root.tsx and should be kept in sync
interface SidebarLayoutProps {
  aboveSidebarHeaderHeight?: number;
  aboveMainContentHeaderHeight?: number;
}

const SidebarLayout = styled(Box, {
  name: 'RHDHPageWithoutFixHeight',
  slot: 'sidebarLayout',
  shouldForwardProp: prop =>
    prop !== 'aboveSidebarHeaderHeight' &&
    prop !== 'aboveMainContentHeaderHeight',
})<SidebarLayoutProps>(
  ({
    aboveSidebarHeaderHeight,
    aboveMainContentHeaderHeight,
    theme,
  }: SidebarLayoutProps & {
    theme?: Theme;
  }) => ({
    // We remove Backstage's 100vh on the content, and instead rely on flexbox
    // to take up the whole viewport.
    display: 'flex',
    flexGrow: 1,
    maxHeight: `calc(100vh - ${aboveSidebarHeaderHeight ?? 0}px)`,

    // BackstageSidebarPage-root
    '& > div': {
      display: 'flex',
      flexDirection: 'column',
      height: 'unset',
      flexGrow: 1,
      marginLeft: 0,
      paddingLeft: 0,
      // Here we override the theme so that the Backstage default page suspense
      // takes up the whole height of the page instead of 100vh. The difference
      // lies in the height of the global header above the sidebar.
      '@media (min-width: 600px)': {
        '& > [class*="MuiLinearProgress-root"]': {
          height: 'unset',
          flexGrow: 1,
        },
      },
    },

    '& main': {
      // The height is controlled by the flexbox in the BackstageSidebarPage.
      height: `calc(100vh - ${aboveSidebarHeaderHeight! + aboveMainContentHeaderHeight!}px)`,
      flexGrow: 1,
      marginLeft: '76px !important',
      width: 'calc(100vw - 76px) !important',
      maxWidth: 'calc(100vw - 76px) !important',
      paddingLeft: 0,
      overflowX: 'hidden',
      boxSizing: 'border-box',
    },

    // When drawer is docked, adjust the content size
    'body.docked-drawer-open #rhdh-sidebar-layout&': {
      '> div > main': {
        marginRight: `calc(var(--docked-drawer-width, 500px) + ${(theme as ThemeConfig).palette?.rhdh?.general.pageInset})`,
        transition: 'margin-right 0.3s ease',
      },
    },

    // BackstageSidebarPage-root > nav > BackstageSidebar-root > BackstageSidebar-drawer
    '& > div > nav > div > div': {
      // We need to compensate for the above-sidebar position of the global header
      // as it takes up a fixed height at the top of the page.
      top: `max(0px, ${aboveSidebarHeaderHeight ?? 0}px)`,
      width: '76px !important',
    },
  }),
);

export const Root = ({ children }: PropsWithChildren<{}>) => {
  const aboveSidebarHeaderHeight = 0;
  const aboveMainContentHeaderHeight = 0;

  const { dynamicRoutes, menuItems } = useContext(DynamicRootContext);

  const configApi = useApi(configApiRef);

  const showSettings =
    configApi.getOptionalBoolean('app.sidebar.settings') ?? true;
  const showAdministration =
    configApi.getOptionalBoolean('app.sidebar.administration') ?? true;

  usePermission({
    permission: policyEntityCreatePermission,
    resourceRef: undefined,
  });
  useLanguagePreference();
  const { t } = useTranslation();

  const getMenuText = (menuItem: ResolvedMenuItem, count?: number) => {
    if (menuItem.titleKey) {
      return t(menuItem.titleKey as any, { count: count ?? 1 } as any);
    }
    return menuItem.title;
  };


  const dynamicMenuItems = dynamicRoutes.map(({ scope, menuItem, path }) => {
    if (menuItem && 'Component' in menuItem) {
      return (
        <menuItem.Component
          {...(menuItem.config?.props || {})}
          key={`${scope}/${path}`}
          to={path}
        />
      );
    }
    return null;
  });

  return (
    <PageWithoutFixHeight>
      <SidebarLayout
        id="rhdh-sidebar-layout"
        aboveSidebarHeaderHeight={aboveSidebarHeaderHeight}
        aboveMainContentHeaderHeight={aboveMainContentHeaderHeight}
      >
        <SidebarPage>
          <Sidebar>
            <OpsPilotSidebar
              menuItems={menuItems}
              dynamicMenuItems={dynamicMenuItems}
              getMenuText={getMenuText}
              showAdministration={showAdministration}
              showSettings={showSettings}
            />
          </Sidebar>
          {children}
        </SidebarPage>
      </SidebarLayout>
    </PageWithoutFixHeight>
  );
};
