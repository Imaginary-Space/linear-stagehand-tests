# Test Scenarios

This document describes the end-to-end test scenarios using Given/When/Then (BDD) format.

---

## Authentication Tests

### Scenario: Successful Login with Valid Credentials

**Given** a user is on the login page  
**When** they enter valid email and password credentials  
**And** they click the submit button  
**Then** the sidebar navigation should become visible  
**And** no error message should be displayed  

---

### Scenario: Failed Login with Invalid Credentials

**Given** a user is on the login page  
**And** they have no existing authentication cookies  
**When** they enter an invalid email "invalid@example.com"  
**And** they enter an invalid password "wrongpassword123"  
**And** they click the submit button  
**Then** the user should remain on the login page  
**And** an error message may be displayed  

---

### Scenario: Protected Route Redirect

**Given** a user is not authenticated  
**And** all cookies and localStorage are cleared  
**When** they try to access a protected route "/founders"  
**Then** they should be redirected to the login page  
**And** the login form should be visible  

---

## Founder Management Tests

### Scenario: Display Founders List

**Given** a user is authenticated  
**When** they navigate to the "/founders" page  
**Then** the page should fully load  
**And** founder cards should be visible  

---

### Scenario: View Founder Details

**Given** a user is on the founders list page  
**When** they click on the first founder card  
**Then** the founder detail page should load  
**And** the founder's name should be visible  
**And** the detail tabs (Overview, Financials, Website) should be visible  

---

### Scenario: Navigate Through Founder Detail Tabs

**Given** a user is viewing a founder's details  
**When** they click on a tab (e.g., "Financials", "Website", "Knowledge")  
**Then** the corresponding tab content should be displayed  

---

### Scenario: View Founder Overview Information

**Given** a user is viewing a founder's details  
**When** they click on the "Overview" tab  
**Then** at least one of the following should be visible:
  - Company information
  - Contact information
  - Summary or description  

---

### Scenario: Search/Filter Founders

**Given** a user is on the founders list page  
**And** a search input is visible  
**When** they type "test" into the search input  
**Then** the founders list should update to show filtered results  

---

## Product Ideas Tests

### Scenario: Load Ideas Page

**Given** a user is authenticated  
**When** they navigate to the "/ideas" page  
**Then** the page should fully load  
**And** the "Product Ideas" header should be visible  

---

### Scenario: Display Idea Cards

**Given** a user is on the ideas page  
**When** the page has loaded  
**Then** idea cards should be visible  
**And** the idea count should be zero or more  

---

### Scenario: Sort Ideas

**Given** a user is on the ideas page  
**And** a sort dropdown is visible  
**When** they click on the sort dropdown  
**And** they select "Date"  
**And** they choose "newest first"  
**Then** the sort should be applied successfully  

---

### Scenario: Expand Idea Card

**Given** a user is on the ideas page  
**And** there are expandable idea cards  
**When** they click on the first idea card  
**Then** the idea card should expand  
**And** additional details should be visible  

---

### Scenario: Display Idea Statistics Summary

**Given** a user is on the ideas page  
**When** the page has loaded  
**Then** at least one of the following should be visible:
  - Statistics summary section
  - Total ideas count
  - Tweets analyzed count  

---

## Admin Features Tests

### Scenario: Load Admin Panel with Users List

**Given** a user is authenticated as an admin  
**When** they navigate to the "/admin" page  
**Then** they should remain on the admin page (not redirected)  
**And** a users list may be visible (table or list format)  

---

### Scenario: User Search Functionality

**Given** an admin is on the admin panel  
**And** a user search input is visible  
**When** they type the portal username into the search input  
**Then** the user list should be filtered  
**And** at least one user should be shown in the results  

---

### Scenario: View User Details

**Given** an admin is on the admin panel  
**When** they click on the first user in the users list  
**Then** user details should become visible  
**And** the user's email may be displayed  
**And** role information may be displayed  

---

### Scenario: Founder Assignment Functionality

**Given** an admin is on the admin panel  
**When** they click on a user in the users list  
**Then** an assignment UI should be visible (button, dropdown, or select)  
**Or** the URL should change to a user detail view  

---

### Scenario: Access Denied for Non-Admin Users

**Given** a user is authenticated but not an admin  
**When** they navigate to the "/admin" page  
**Then** one of the following should occur:
  - An access denied message is shown
  - The user is redirected away from admin
  - Full admin access is granted (if user is actually an admin)  

---

## Test Infrastructure

All tests use the following common setup:

- **Stagehand** browser automation with AI-powered interactions
- **Playwright** for direct DOM manipulation when speed is critical
- **Zod** schemas for structured data extraction
- **Environment configuration** for credentials and base URL
- **Shared authentication** utilities for login state management

### Timeouts

All tests are configured with a consistent `TEST_TIMEOUT` value to handle network latency and AI processing time.
