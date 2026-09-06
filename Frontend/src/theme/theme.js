import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",

    primary: {
      main: "#0B3D91",
      light: "#2F65B9",
      dark: "#082E6D",
      contrastText: "#FFFFFF",
    },

    secondary: {
      main: "#1E88E5",
      light: "#63B3ED",
      dark: "#1565C0",
      contrastText: "#FFFFFF",
    },

    success: {
      main: "#16803C",
      light: "#E8F5E9",
      dark: "#0B5E2A",
    },

    warning: {
      main: "#D97706",
      light: "#FFF7E6",
      dark: "#92400E",
    },

    error: {
      main: "#C62828",
      light: "#FDECEC",
      dark: "#8E1B1B",
    },

    info: {
      main: "#1976D2",
      light: "#EAF4FF",
      dark: "#0D47A1",
    },

    background: {
      default: "#F5F7FB",
      paper: "#FFFFFF",
    },

    text: {
      primary: "#172033",
      secondary: "#667085",
    },

    divider: "#E6EAF0",
  },

  typography: {
    fontFamily: [
      "Inter",
      "Roboto",
      "Arial",
      "sans-serif",
    ].join(","),

    h1: {
      fontWeight: 700,
      letterSpacing: "-0.03em",
    },

    h2: {
      fontWeight: 700,
      letterSpacing: "-0.025em",
    },

    h3: {
      fontWeight: 700,
      letterSpacing: "-0.02em",
    },

    h4: {
      fontWeight: 700,
      letterSpacing: "-0.02em",
    },

    h5: {
      fontWeight: 700,
    },

    h6: {
      fontWeight: 700,
    },

    button: {
      textTransform: "none",
      fontWeight: 600,
    },
  },

  shape: {
    borderRadius: 12,
  },

  shadows: [
    "none",
    "0 1px 2px rgba(16, 24, 40, 0.05)",
    "0 2px 6px rgba(16, 24, 40, 0.06)",
    "0 4px 12px rgba(16, 24, 40, 0.07)",
    "0 6px 16px rgba(16, 24, 40, 0.08)",
    "0 8px 24px rgba(16, 24, 40, 0.09)",
    "0 10px 30px rgba(16, 24, 40, 0.10)",
    "0 12px 36px rgba(16, 24, 40, 0.11)",
    "0 14px 42px rgba(16, 24, 40, 0.12)",
    "0 16px 48px rgba(16, 24, 40, 0.13)",
    "0 18px 54px rgba(16, 24, 40, 0.14)",
    "0 20px 60px rgba(16, 24, 40, 0.15)",
    "0 22px 66px rgba(16, 24, 40, 0.16)",
    "0 24px 72px rgba(16, 24, 40, 0.17)",
    "0 26px 78px rgba(16, 24, 40, 0.18)",
    "0 28px 84px rgba(16, 24, 40, 0.19)",
    "0 30px 90px rgba(16, 24, 40, 0.20)",
    "0 32px 96px rgba(16, 24, 40, 0.21)",
    "0 34px 102px rgba(16, 24, 40, 0.22)",
    "0 36px 108px rgba(16, 24, 40, 0.23)",
    "0 38px 114px rgba(16, 24, 40, 0.24)",
    "0 40px 120px rgba(16, 24, 40, 0.25)",
    "0 42px 126px rgba(16, 24, 40, 0.26)",
    "0 44px 132px rgba(16, 24, 40, 0.27)",
    "0 46px 138px rgba(16, 24, 40, 0.28)",
  ],

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          height: "100%",
        },

        body: {
          margin: 0,
          minHeight: "100%",
          backgroundColor: "#F5F7FB",
          color: "#172033",
          fontFamily: "Inter, Roboto, Arial, sans-serif",
        },

        "#root": {
          minHeight: "100vh",
        },

        "*": {
          boxSizing: "border-box",
        },

        "*::-webkit-scrollbar": {
          width: "8px",
          height: "8px",
        },

        "*::-webkit-scrollbar-track": {
          background: "#F1F3F7",
        },

        "*::-webkit-scrollbar-thumb": {
          background: "#C6CDD8",
          borderRadius: "10px",
        },

        "*::-webkit-scrollbar-thumb:hover": {
          background: "#98A2B3",
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid #E6EAF0",
          borderRadius: 16,
          boxShadow: "0 2px 8px rgba(16, 24, 40, 0.05)",
          backgroundImage: "none",
          transition:
            "box-shadow 0.2s ease, transform 0.2s ease",

          "&:hover": {
            boxShadow: "0 6px 18px rgba(16, 24, 40, 0.08)",
          },
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          borderRadius: 14,
        },

        elevation1: {
          boxShadow: "0 2px 8px rgba(16, 24, 40, 0.05)",
        },

        elevation2: {
          boxShadow: "0 4px 14px rgba(16, 24, 40, 0.07)",
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          minHeight: 40,
          padding: "8px 16px",
          boxShadow: "none",

          "&:hover": {
            boxShadow: "none",
          },
        },

        containedPrimary: {
          "&:hover": {
            backgroundColor: "#082E6D",
          },
        },

        outlined: {
          borderWidth: 1,

          "&:hover": {
            borderWidth: 1,
          },
        },
      },
    },

    MuiTextField: {
      defaultProps: {
        variant: "outlined",
        size: "small",
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          backgroundColor: "#FFFFFF",

          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "#98A2B3",
          },

          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderWidth: 2,
          },
        },

        notchedOutline: {
          borderColor: "#D0D5DD",
        },
      },
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: "#667085",
        },
      },
    },

    MuiTableContainer: {
      styleOverrides: {
        root: {
          border: "1px solid #E6EAF0",
          borderRadius: 14,
          boxShadow: "0 1px 4px rgba(16, 24, 40, 0.04)",
        },
      },
    },

    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: "#F8FAFC",

          "& .MuiTableCell-head": {
            color: "#475467",
            fontWeight: 700,
            fontSize: "0.78rem",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            borderBottom: "1px solid #E6EAF0",
          },
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: "1px solid #EEF1F5",
          padding: "13px 16px",
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: "background-color 0.15s ease",

          "&:hover": {
            backgroundColor: "#F8FAFC",
          },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 7,
          fontWeight: 600,
        },

        sizeSmall: {
          height: 28,
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 46,
        },

        indicator: {
          height: 3,
          borderRadius: "3px 3px 0 0",
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          minHeight: 46,
          paddingLeft: 18,
          paddingRight: 18,
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(16, 24, 40, 0.18)",
        },
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontWeight: 700,
          padding: "22px 24px 16px",
        },
      },
    },

    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: "8px 24px 20px",
        },
      },
    },

    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: "16px 24px 22px",
          gap: 8,
        },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 7,
          fontSize: "0.78rem",
        },
      },
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 7,
          margin: "2px 6px",
        },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "#E6EAF0",
        },
      },
    },
  },
});

export default theme;