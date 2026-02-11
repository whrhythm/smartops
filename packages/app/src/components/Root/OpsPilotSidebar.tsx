import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { List, ListItemButton, ListItemIcon, Tooltip } from '@mui/material';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { alpha, useTheme } from '@mui/material/styles';

import Settings from '@mui/icons-material/Settings';

import { ResolvedMenuItem } from '@red-hat-developer-hub/plugin-utils';

import { MenuIcon } from './MenuIcon';

type MenuRenderProps = {
  menuItems: ResolvedMenuItem[];
  dynamicMenuItems: React.ReactNode[];
  getMenuText: (menuItem: ResolvedMenuItem) => string;
  showAdministration: boolean;
  showSettings: boolean;
};

const renderIcon = (iconName: string) => <MenuIcon icon={iconName} />;

const filterMenuItems = (
  items: ResolvedMenuItem[],
  isDefaultMenuSection: boolean,
  isBottomMenuSection: boolean,
) => {
  let menuItemArray = isDefaultMenuSection
    ? items.filter(mi => mi.name.startsWith('default.'))
    : items.filter(mi => !mi.name.startsWith('default.'));

  menuItemArray = isBottomMenuSection
    ? menuItemArray.filter(mi => mi.name.includes('admin'))
    : menuItemArray.filter(mi => !mi.name.includes('admin'));

  return menuItemArray;
};

const OpsPilotSidebar = ({
  menuItems,
  dynamicMenuItems,
  getMenuText,
  showAdministration,
  showSettings,
}: MenuRenderProps) => {
  const theme = useTheme();
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  const toggleItem = (name: string) => {
    setOpenItems(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const topMenuItems = useMemo(
    () => filterMenuItems(menuItems, true, false),
    [menuItems],
  );

  const customMenuItems = useMemo(
    () => filterMenuItems(menuItems, false, false),
    [menuItems],
  );

  const adminMenuItems = useMemo(
    () => filterMenuItems(menuItems, true, true),
    [menuItems],
  );

  const listSx = {
    '& .MuiListItemButton-root': {
      borderRadius: 8,
      px: 1,
      py: 1,
      justifyContent: 'center',
      color: theme.palette.text.primary,
      '&.Mui-selected, &.Mui-selected:hover': {
        backgroundColor: alpha(theme.palette.primary.main, 0.2),
      },
    },
    '& .MuiListItemIcon-root': {
      minWidth: 'auto',
      color: theme.palette.text.secondary,
    },
    '& .MuiListItemText-root': {
      display: 'none',
    },
  };

  const renderMenuTree = (items: ResolvedMenuItem[], level = 0) =>
    items.map(item => {
      const hasChildren = !!item.children?.length;
      const isOpen = openItems[item.name] ?? false;
      const indent = level > 0 ? 0.5 : 0.5;

      return (
        <Fragment key={item.name}>
          <Tooltip title={getMenuText(item)} placement="right">
            <ListItemButton
              component={item.to ? Link : 'div'}
              to={item.to || undefined}
              onClick={hasChildren ? () => toggleItem(item.name) : undefined}
              sx={{ pl: indent }}
              aria-label={getMenuText(item)}
            >
              <ListItemIcon>{renderIcon(item.icon ?? '')}</ListItemIcon>
            </ListItemButton>
          </Tooltip>
          {hasChildren && isOpen && (
            <Box sx={{ pl: 1 }}>
              <List disablePadding sx={listSx}>
                {renderMenuTree(item.children ?? [], level + 1)}
              </List>
            </Box>
          )}
        </Fragment>
      );
    });

  return (
    <Box
      sx={{
        width: 76,
        bgcolor: theme.palette.background.paper,
        borderRight: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <Box sx={{ px: 1, py: 1.5, display: 'flex', justifyContent: 'center' }}>
        <Tooltip title="OpsPilot" placement="right">
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              color: theme.palette.primary.main,
              fontWeight: 700,
            }}
          >
            OP
          </Box>
        </Tooltip>
      </Box>

      <Divider />

      <Box sx={{ px: 1, py: 1 }}>
        <List dense sx={listSx}>
          <Tooltip title="Home" placement="right">
            <ListItemButton component={Link} to="/" aria-label="Home">
              <ListItemIcon>{renderIcon('home')}</ListItemIcon>
            </ListItemButton>
          </Tooltip>
          <Tooltip title="Kubernetes" placement="right">
            <ListItemButton component={Link} to="/?view=k8s" aria-label="Kubernetes">
              <ListItemIcon>{renderIcon('kubernetes')}</ListItemIcon>
            </ListItemButton>
          </Tooltip>
          <Tooltip title="CI/CD" placement="right">
            <ListItemButton component={Link} to="/?view=cicd" aria-label="CI/CD">
              <ListItemIcon>{renderIcon('cicd')}</ListItemIcon>
            </ListItemButton>
          </Tooltip>
          <Tooltip title="VMs" placement="right">
            <ListItemButton component={Link} to="/?view=vms" aria-label="VMs">
              <ListItemIcon>{renderIcon('virtual-machines')}</ListItemIcon>
            </ListItemButton>
          </Tooltip>
        </List>
      </Box>

      <Divider />

      <Box sx={{ flex: 1, overflow: 'auto', px: 1, py: 1 }}>
        <List sx={listSx}>{renderMenuTree(topMenuItems)}</List>
        <Divider sx={{ my: 1 }} />
        <Box
          sx={{
            '& .MuiListItemText-root': { display: 'none' },
            '& .MuiListItemIcon-root': { minWidth: 'auto' },
            '& .MuiListItemButton-root': { justifyContent: 'center', px: 1 },
          }}
        >
          <List sx={listSx}>{renderMenuTree(customMenuItems)}</List>
          <List sx={listSx}>{dynamicMenuItems}</List>
        </Box>
      </Box>

      {showAdministration && (
        <>
          <Divider />
          <Box sx={{ px: 1, py: 1 }}>
            <List sx={listSx}>{renderMenuTree(adminMenuItems)}</List>
          </Box>
        </>
      )}

      {showSettings && (
        <>
          <Divider />
          <Box sx={{ px: 1, py: 1 }}>
            <List sx={listSx}>
              <Tooltip title="Settings" placement="right">
                <ListItemButton component={Link} to="/settings" aria-label="Settings">
                  <ListItemIcon>
                    <Settings fontSize="small" />
                  </ListItemIcon>
                </ListItemButton>
              </Tooltip>
            </List>
          </Box>
        </>
      )}
    </Box>
  );
};

export default OpsPilotSidebar;
