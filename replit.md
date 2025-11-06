# RaspadinhaKanpary - Casino Scratch Card Game

## Overview
RaspadinhaKanpary is a professional online scratch card game system with full BullsPay payment integration. Users can deposit funds, play scratch cards, and withdraw their winnings via PIX. The project aims to provide a secure, engaging, and real-time gaming experience with a comprehensive administrative panel for management and fraud detection.

## Recent Changes (November 2025)
- **PIX Key Formatting**: Automatic formatting of PIX keys (CPF/CNPJ/phone = digits only, email = lowercase) according to BullsPay API requirements
- **BullsPay Balance Validation**: Admin cannot approve withdrawals exceeding available BullsPay balance (prevents payment failures)
- **Auto-fill PIX Keys**: Withdrawal page automatically fills user's registered CPF or email as PIX key
- **Password Visibility Toggle**: Eye icon button to show/hide password on login and registration pages
- **CPF Warning**: Alert message on registration page emphasizing the need for real CPF for withdrawal validation
- **Optimized Scratch Cooldown**: Reduced from 5 seconds to 2 seconds for faster gameplay
- **System Initialization Script**: `scripts/init-system.js` sets up database, creates admin account (admin@kr.com / Admin@123), and test account (teste500@example.com / Teste@123 with R$500)

## User Preferences
- Design moderno e profissional
- Sem raspar manual (automático)
- Verificação em tempo real de transações
- Painel admin completo
- Sistema real, sem simulações
- CPF verdadeiro obrigatório para saques funcionarem

## System Architecture

### Technology Stack
- **Backend**: Node.js 20 with Express
- **Frontend**: HTML5/CSS3/JavaScript (Vanilla)
- **Database**: PostgreSQL (Neon)
- **Payment Gateway**: BullsPay (Official API)
- **Authentication**: JWT with bcrypt
- **Package Manager**: npm

### Key Features
- **Authentication**: User registration (username, email, password, CPF), JWT-based login (7-day validity), authentication and admin middlewares.
- **Wallet & Transactions**: Real-time balance, comprehensive transaction history, atomic transactions.
- **Deposits**: Official BullsPay integration, PIX QR Code generation, automatic payment verification (5-second polling), automatic redirection post-payment, 5-minute deposit expiration with frontend countdown.
- **Withdrawals**: Support for all PIX key types (CPF, CNPJ, email, phone, random), automatic PIX key formatting, auto-fill user's CPF/email, BullsPay balance validation before approval, automatic status verification, automatic balance return on failure, manual approval system for withdrawals via admin panel.
- **Scratch Card Game**: Automatic scratching animation, configurable RTP (default 95%), variable bet amounts (R$0.50 to R$50.00) with progressive odds, win multipliers, game history, optimized 2-second cooldown between plays.
- **Admin Panel**: Real-time RTP configuration, BullsPay balance inquiry, detailed transaction listings (with filters), transaction refunds, BullsPay transaction/withdrawal listings, user management, manual withdrawal approval/rejection, comprehensive antifraud system with real-time alerts.
- **Security**: JWT in httpOnly cookies, secure cookies in production (HTTPS), sameSite: 'strict' for CSRF protection, token never exposed in JSON responses, CORS configured with credentials, password hashing with bcrypt, CPF validation, atomic transactions, dedicated admin role.
- **Rollover System**: 1x rollover requirement on first deposit, applied atomically to prevent race conditions. Withdrawals are only permitted when rollover is cleared.
- **Antifraud System**: Module `src/fraud.js` with 7 detection methods (duplicate CPF, suspicious win rate, immediate withdrawals, multiple failed deposits, suspicious timings, prolonged inactivity, inconsistent bets).

### Database Schema
- **Users**: Stores user details including `balance`, `rollover_required`, `first_deposit_made`, and `is_admin`.
- **Transactions**: Records all deposits and withdrawals, including `type`, `amount`, `status`, `gateway_id`, `gateway_data`, PIX details, and `expires_at` for deposits.
- **Game Rounds**: Logs each scratch card game played with `bet_amount`, `prize_amount`, `multiplier`, and `result_data`.
- **Settings**: Stores key-value application settings.

## External Dependencies
- **BullsPay**: Official API for payment processing (deposits and withdrawals). Client ID: bp_client_f8993AbnLUYM99rh0tJMQ4SqXfq0Yxk4
- **PostgreSQL (Neon)**: Relational database for persistent storage.
- **Node.js/Express**: Backend server environment.
- **bcrypt**: For password hashing.
- **jsonwebtoken**: For user authentication.

## Setup & Initialization
Run `node scripts/init-system.js` to:
1. Initialize database tables
2. Create admin account (admin@kr.com / Admin@123)
3. Create test account (teste500@example.com / Teste@123 with R$500 balance, rollover cleared)