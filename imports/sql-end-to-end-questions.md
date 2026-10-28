# SQL Questions and Solutions

## Q1 - 3 or More Consecutive Empty Seats

Find seats with 3 or more consecutive empty seats in a booking management system (bms).

```sql
WITH CTE AS (
    SELECT 
        seat_no, 
        is_empty,
        ROW_NUMBER() OVER(ORDER BY seat_no) AS rn,
        seat_no - ROW_NUMBER() OVER(ORDER BY seat_no) AS empty_seats
    FROM bms
    WHERE is_empty = 'Y'
)
SELECT seat_no
FROM CTE 
WHERE empty_seats IN (
    SELECT empty_seats 
    FROM CTE 
    GROUP BY empty_seats
    HAVING COUNT(*) >= 3
)
```

**Expected Output**:

| seat_no |
|---------|
| 7       |
| 8       |
| 9       |

## Q2 - Fraction of Users Upgrading to Prime Membership

Calculate the fraction of users who accessed Amazon Music and upgraded to Prime within 30 days, rounded to two decimal places.

```sql
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    user_id INTEGER,
    name VARCHAR(20),
    join_date DATE
);

INSERT INTO users VALUES 
(1, 'Jon', CAST('2-14-20' AS DATE)), 
(2, 'Jane', CAST('2-14-20' AS DATE)), 
(3, 'Jill', CAST('2-15-20' AS DATE)), 
(4, 'Josh', CAST('2-15-20' AS DATE)), 
(5, 'Jean', CAST('2-16-20' AS DATE)), 
(6, 'Justin', CAST('2-17-20' AS DATE)),
(7, 'Jeremy', CAST('2-18-20' AS DATE));

DROP TABLE IF EXISTS events;
CREATE TABLE events (
    user_id INTEGER,
    type VARCHAR(10),
    access_date DATE
);

INSERT INTO events VALUES
(1, 'Pay', CAST('3-1-20' AS DATE)), 
(2, 'Music', CAST('3-2-20' AS DATE)), 
(2, 'P', CAST('3-12-20' AS DATE)),
(3, 'Music', CAST('3-15-20' AS DATE)), 
(4, 'Music', CAST('3-15-20' AS DATE)), 
(1, 'P', CAST('3-16-20' AS DATE)), 
(3, 'P', CAST('3-22-20' AS DATE));

SELECT 
    COUNT(*) AS total_users, 
    COUNT(CASE WHEN DATEDIFF(DAY, join_date, access_date) < 30 THEN u.user_id END) AS p_memb,
    ROUND(COUNT(CASE WHEN DATEDIFF(DAY, join_date, access_date) < 30 THEN u.user_id END) * 1.0 / COUNT(*) * 100, 2) AS prime_members
FROM users u
LEFT JOIN events e
    ON u.user_id = e.user_id 
    AND type = 'P'
WHERE u.user_id IN (
    SELECT user_id 
    FROM events 
    WHERE type = 'Music'
)
```

**Expected Output**:

| total_users | p_memb | prime_members |
|-------------|--------|---------------|
| 3           | 2      | 66.67         |

## Q3 - Task Result Periods

Group task results (success or fail) by consecutive dates.

```sql
DROP TABLE IF EXISTS tasks;
CREATE TABLE tasks (
    date_value DATE,
    state VARCHAR(10)
);

INSERT INTO tasks VALUES 
('2022-01-01', 'success'),
('2022-01-02', 'success'),
('2022-01-03', 'fail'),
('2022-01-04', 'success'),
('2022-01-05', 'fail'),
('2022-01-06', 'fail'),
('2022-01-07', 'fail'),
('2022-01-08', 'success');

WITH CTE AS (
    SELECT 
        date_value, 
        state,
        ROW_NUMBER() OVER(PARTITION BY state ORDER BY date_value) AS rn,
        DATEDIFF(DAY, ROW_NUMBER() OVER(PARTITION BY state ORDER BY date_value), date_value) AS difference
    FROM tasks
)
SELECT 
    MIN(date_value) AS start_date, 
    MAX(date_value) AS end_date, 
    state AS result
FROM CTE
GROUP BY state, difference
ORDER BY start_date
```

**Expected Output**:

| start_date  | end_date    | result  |
|-------------|-------------|---------|
| 2022-01-01  | 2022-01-02  | success |
| 2022-01-03  | 2022-01-03  | fail    |
| 2022-01-04  | 2022-01-04  | success |
| 2022-01-05  | 2022-01-07  | fail    |
| 2022-01-08  | 2022-01-08  | success |

## Q4 - Highest Average Rated Movie by Genre

Find the movie with the highest average rating in each genre, displaying the rating as stars.

```sql
DROP TABLE IF EXISTS movies;
CREATE TABLE movies (
    id INT PRIMARY KEY,
    genre VARCHAR(50),
    title VARCHAR(100)
);

DROP TABLE IF EXISTS reviews;
CREATE TABLE reviews (
    movie_id INT,
    rating DECIMAL(3,1),
    FOREIGN KEY (movie_id) REFERENCES movies(id)
);

INSERT INTO movies (id, genre, title) VALUES
(1, 'Action', 'The Dark Knight'),
(2, 'Action', 'Avengers: Infinity War'),
(3, 'Action', 'Gladiator'),
(4, 'Action', 'Die Hard'),
(5, 'Action', 'Mad Max: Fury Road'),
(6, 'Drama', 'The Shawshank Redemption'),
(7, 'Drama', 'Forrest Gump'),
(8, 'Drama', 'The Godfather'),
(9, 'Drama', 'Schindler''s List'),
(10, 'Drama', 'Fight Club'),
(11, 'Comedy', 'The Hangover'),
(12, 'Comedy', 'Superbad'),
(13, 'Comedy', 'Dumb and Dumber'),
(14, 'Comedy', 'Bridesmaids'),
(15, 'Comedy', 'Anchorman: The Legend of Ron Burgundy');

INSERT INTO reviews (movie_id, rating) VALUES
(1, 4.5), (1, 4.0), (1, 5.0),
(2, 4.2), (2, 4.8), (2, 3.9),
(3, 4.6), (3, 3.8), (3, 4.3),
(4, 4.1), (4, 3.7), (4, 4.4),
(5, 3.9), (5, 4.5), (5, 4.2),
(6, 4.8), (6, 4.7), (6, 4.9),
(7, 4.6), (7, 4.9), (7, 4.3),
(8, 4.9), (8, 5.0), (8, 4.8),
(9, 4.7), (9, 4.9), (9, 4.5),
(10, 4.6), (10, 4.3), (10, 4.7),
(11, 3.9), (11, 4.0), (11, 3.5),
(12, 3.7), (12, 3.8), (12, 4.2),
(13, 3.2), (13, 3.5), (13, 3.8),
(14, 3.8), (14, 4.0), (14, 4.2),
(15, 3.9), (15, 4.0), (15, 4.1);

WITH CTE AS (
    SELECT 
        genre, 
        title, 
        AVG(rating) AS average_rating,
        ROW_NUMBER() OVER(PARTITION BY genre ORDER BY AVG(rating) DESC) AS rn
    FROM movies m 
    JOIN reviews r 
        ON m.id = r.movie_id
    GROUP BY genre, title
)
SELECT 
    genre, 
    title, 
    ROUND(average_rating, 0) AS average_rating,
    REPLICATE('*', ROUND(average_rating, 0)) AS rating
FROM CTE 
WHERE rn = 1
```

**Expected Output**:

| genre  | title                   | average_rating | rating |
|--------|-------------------------|----------------|--------|
| Action | The Dark Knight         | 5              | *****  |
| Comedy | Anchorman: The Legend of Ron Burgundy | 4 | ****   |
| Drama  | The Godfather           | 5              | *****  |

## Q5 - Maximum Countries a Person Can Live In

Find the maximum number of countries a person can live in based on family size constraints.

```sql
DROP TABLE IF EXISTS FAMILIES;
CREATE TABLE FAMILIES (
    ID VARCHAR(50),
    NAME VARCHAR(50),
    FAMILY_SIZE INT
);

INSERT INTO FAMILIES (ID, NAME, FAMILY_SIZE) VALUES 
('c00dac11bde74750b4d207b9c182a85f', 'Alex Thomas', 9),
('eb6f2d3426694667ae3e79d6274114a4', 'Chris Gray', 2),
('3f7b5b8e835d4e1c8b3e12e964a741f3', 'Emily Johnson', 4),
('9a345b079d9f4d3cafb2d4c11d20f8ce', 'Michael Brown', 6),
('e0a5f57516024de2a231d09de2cbe9d1', 'Jessica Wilson', 3);

DROP TABLE IF EXISTS COUNTRIES;
CREATE TABLE COUNTRIES (
    ID VARCHAR(50),
    NAME VARCHAR(50),
    MIN_SIZE INT,
    MAX_SIZE INT
);

INSERT INTO COUNTRIES (ID, NAME, MIN_SIZE, MAX_SIZE) VALUES 
('023fd23615bd4ff4b2ae0a13ed7efec9', 'Bolivia', 2, 4),
('be247f73de0f4b2d810367cb26941fb9', 'Cook Islands', 4, 8),
('3e85ab80a6f84ef3b9068b21dbcc54b3', 'Brazil', 4, 7),
('e571e164152c4f7c8413e2734f67b146', 'Australia', 5, 9),
('f35a7bb7d44342f7a8a42a53115294a8', 'Canada', 3, 5),
('a1b5a4b5fc5f46f891d9040566a78f27', 'Japan', 10, 12);

SELECT 
    MAX(cnt_of_countries) AS maximum_countries
FROM (
    SELECT 
        f.NAME, 
        COUNT(*) AS cnt_of_countries 
    FROM FAMILIES f
    JOIN COUNTRIES c
        ON f.FAMILY_SIZE BETWEEN c.MIN_SIZE AND c.MAX_SIZE
    GROUP BY f.NAME
) AS A
```

**Expected Output**:

| maximum_countries |
|------------------|
| 4                |

## Q6 - Cancellation Rate of Unbanned Users

Calculate the cancellation rate of requests by unbanned users for each date.

```sql
DROP TABLE IF EXISTS Trips;
CREATE TABLE Trips (
    id INT, 
    client_id INT, 
    driver_id INT, 
    city_id INT, 
    status VARCHAR(50), 
    request_at VARCHAR(50)
);

INSERT INTO Trips (id, client_id, driver_id, city_id, status, request_at) VALUES 
('1', 1, 10, 1, 'completed', '2013-10-01'),
('2', 2, 11, 1, 'cancelled_by_driver', '2013-10-01'),
('3', 3, 12, 6, 'completed', '2013-10-01'),
('4', 4, 13, 6, 'cancelled_by_client', '2013-10-01'),
('5', 1, 10, 1, 'completed', '2013-10-02'),
('6', 2, 11, 6, 'completed', '2013-10-02'),
('7', 3, 12, 6, 'completed', '2013-10-02'),
('8', 2, 12, 12, 'completed', '2013-10-03'),
('9', 3, 10, 12, 'completed', '2013-10-03'),
('10', 4, 13, 12, 'cancelled_by_driver', '2013-10-03');

DROP TABLE IF EXISTS Users;
CREATE TABLE Users (
    users_id INT, 
    banned VARCHAR(50), 
    role VARCHAR(50)
);

INSERT INTO Users (users_id, banned, role) VALUES 
('1', 'No', 'client'),
('2', 'Yes', 'client'),
('3', 'No', 'client'),
('4', 'No', 'client'),
('10', 'No', 'driver'),
('11', 'No', 'driver'),
('12', 'No', 'driver'),
('13', 'No', 'driver');

WITH CTE AS (
    SELECT 
        id, 
        status, 
        request_at,
        ROW_NUMBER() OVER(PARTITION BY request_at ORDER BY request_at) AS rn
    FROM Trips t
    JOIN Users u 
        ON t.client_id = u.users_id
    WHERE u.banned = 'No'
)
SELECT 
    request_at,
    ROUND((SUM(CASE WHEN status LIKE 'cancelled%' THEN 1 ELSE 0 END) * 1.0 / COUNT(*)) * 100, 2) AS failure_perc
FROM CTE
GROUP BY request_at
```

**Expected Output**:

| request_at  | failure_perc |
|-------------|--------------|
| 2013-10-01 | 33.33        |
| 2013-10-02 | 0.00         |
| 2013-10-03 | 50.00        |

## Q7 - First and Repeated Customers

Count the number of first-time and repeated customers by order date.

```sql
DROP TABLE IF EXISTS customer_orders;
CREATE TABLE customer_orders (
    order_id INTEGER,
    customer_id INTEGER,
    order_date DATE,
    order_amount INTEGER
);

INSERT INTO customer_orders VALUES
(1, 100, CAST('2022-01-01' AS DATE), 2000),
(2, 200, CAST('2022-01-01' AS DATE), 2500),
(3, 300, CAST('2022-01-01' AS DATE), 2100),
(4, 100, CAST('2022-01-02' AS DATE), 2000),
(5, 400, CAST('2022-01-02' AS DATE), 2200),
(6, 500, CAST('2022-01-02' AS DATE), 2700),
(7, 100, CAST('2022-01-03' AS DATE), 3000),
(8, 400, CAST('2022-01-03' AS DATE), 1000),
(9, 600, CAST('2022-01-03' AS DATE), 3000);

WITH CTE AS (
    SELECT 
        *,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date) AS rn
    FROM customer_orders
)
SELECT 
    order_date,
    SUM(CASE WHEN rn = 1 THEN 1 ELSE 0 END) AS new_customer,
    SUM(CASE WHEN rn > 1 THEN 1 ELSE 0 END) AS repeated_customer
FROM CTE
GROUP BY order_date
ORDER BY order_date
```

**Expected Output**:

| order_date  | new_customer | repeated_customer |
|-------------|--------------|------------------|
| 2022-01-01 | 3            | 0                |
| 2022-01-02 | 2            | 1                |
| 2022-01-03 | 1            | 2                |

## Q8 - Total Visits and Most Visited Floor

Count the total visits and the most visited floor by each person.

```sql
DROP TABLE IF EXISTS entries;
CREATE TABLE entries ( 
    name VARCHAR(20),
    address VARCHAR(20),
    email VARCHAR(20),
    floor INT,
    resources VARCHAR(10)
);

INSERT INTO entries VALUES 
('A', 'Bangalore', 'A@gmail.com', 1, 'CPU'),
('A', 'Bangalore', 'A1@gmail.com', 1, 'CPU'),
('A', 'Bangalore', 'A2@gmail.com', 2, 'DESKTOP'),
('B', 'Bangalore', 'B@gmail.com', 2, 'DESKTOP'),
('B', 'Bangalore', 'B1@gmail.com', 2, 'DESKTOP'),
('B', 'Bangalore', 'B2@gmail.com', 1, 'MONITOR');

WITH CTE AS (
    SELECT 
        *,
        ROW_NUMBER() OVER (PARTITION BY name, floor ORDER BY name) AS rnk,
        COUNT(*) OVER (PARTITION BY name) AS total_visits
    FROM entries
),
CTE_1 AS (
    SELECT 
        name, 
        total_visits,
        floor,
        COUNT(*) AS floor_visits,
        ROW_NUMBER() OVER (PARTITION BY name ORDER BY COUNT(*) DESC, floor) AS floor_rank
    FROM CTE
    GROUP BY name, floor, total_visits
)
SELECT 
    name, 
    MAX(total_visits) AS total_visits, 
    MAX(CASE WHEN floor_rank = 1 THEN floor END) AS max_visited_floor
FROM CTE_1
GROUP BY name

### Easier Way
;WITH CTE AS (
    SELECT 
        *,
        ROW_NUMBER() OVER (PARTITION BY name, floor ORDER BY name) AS rnk,
        COUNT(*) OVER (PARTITION BY name) AS total_visits
    FROM entries
)
SELECT name, total_visits,
CASE WHEN rnk IN (SELECT MAX(rnk) FROM CTE GROUP BY name) THEN [floor] END AS max_visited_floor
FROM CTE
WHERE CASE WHEN rnk IN (SELECT MAX(rnk) FROM CTE GROUP BY name) THEN [floor] END IS NOT NULL

```

**Expected Output**:

| name | total_visits | max_visited_floor |
|------|--------------|-------------------|
| A    | 3            | 1                 |
| B    | 3            | 2                 |

## Q9 - Companies with Multilingual Users

Find companies with at least two users who speak both English and German.

```sql
DROP TABLE IF EXISTS company_users;
CREATE TABLE company_users (
    company_id INT,
    user_id INT,
    language VARCHAR(20)
);

INSERT INTO company_users VALUES 
(1, 1, 'English'),
(1, 1, 'German'),
(1, 2, 'English'),
(1, 3, 'German'),
(1, 3, 'English'),
(1, 4, 'English'),
(2, 5, 'English'),
(2, 5, 'German'),
(2, 5, 'Spanish'),
(2, 6, 'German'),
(2, 6, 'Spanish'),
(2, 7, 'English');

SELECT 
    company_id, 
    COUNT(*) AS no_of_both_language_users
FROM (
    SELECT 
        company_id
    FROM company_users
    WHERE language IN ('English', 'German')
    GROUP BY company_id, user_id
    HAVING COUNT(DISTINCT language) = 2
) subquery
GROUP BY company_id
HAVING COUNT(*) >= 2
```

**Expected Output**:

| company_id | no_of_both_language_users |
|------------|---------------------------|
| 1          | 2                         |

## Q10 - Departments with Below-Average Salary

Identify departments where the average salary is less than the average salary of other departments.

```sql
DROP TABLE IF EXISTS emp;
CREATE TABLE emp (
    emp_id INT,
    emp_name VARCHAR(20),
    department_id INT,
    salary INT,
    manager_id INT,
    emp_age INT
);

INSERT INTO emp VALUES 
(1, 'Ankit', 100, 10000, 4, 39),
(2, 'Mohit', 100, 15000, 5, 48),
(3, 'Vikas', 100, 10000, 4, 37),
(4, 'Rohit', 100, 5000, 2, 16),
(5, 'Mudit', 200, 12000, 6, 55),
(6, 'Agam', 200, 12000, 2, 14),
(7, 'Sanjay', 200, 9000, 2, 13),
(8, 'Ashish', 200, 5000, 2, 12),
(9, 'Mukesh', 300, 6000, 6, 51),
(10, 'Rakesh', 300, 7000, 6, 50);

SELECT 
    department_id, 
    AVG(salary) AS average_salary
FROM emp e1
GROUP BY department_id
HAVING AVG(salary) < (
    SELECT AVG(salary) 
    FROM emp e2 
    WHERE e2.department_id != e1.department_id
)
```

**Expected Output**:

| department_id | average_salary |
|---------------|----------------|
| 300           | 6500           |

## Q11 - ICC Tournament Points Table

Derive a points table for an ICC tournament based on match results.

```sql
DROP TABLE IF EXISTS icc_world_cup;
CREATE TABLE icc_world_cup (
    Team_1 VARCHAR(20),
    Team_2 VARCHAR(20),
    Winner VARCHAR(20)
);

INSERT INTO icc_world_cup VALUES
('India', 'SL', 'India'),
('SL', 'Aus', 'Aus'),
('SA', 'Eng', 'Eng'),
('Eng', 'NZ', 'NZ'),
('Aus', 'India', 'India');

WITH CTE AS (
    SELECT 
        Team_1 AS team_name, 
        COUNT(Team_1) AS matches_played, 
        SUM(CASE WHEN Team_1 = Winner THEN 1 ELSE 0 END) AS win_flag
    FROM icc_world_cup
    GROUP BY Team_1
    UNION ALL
    SELECT 
        Team_2 AS team_name, 
        COUNT(Team_2) AS matches_played, 
        SUM(CASE WHEN Team_2 = Winner THEN 1 ELSE 0 END) AS win_flag
    FROM icc_world_cup
    GROUP BY Team_2
)
SELECT 
    team_name, 
    SUM(matches_played) AS matches_played, 
    SUM(win_flag) AS wins, 
    SUM(matches_played - win_flag) AS losses, 
    SUM(win_flag * 2) AS points
FROM CTE 
GROUP BY team_name
```

**Expected Output**:

| team_name | matches_played | wins | losses | points |
|-----------|----------------|------|--------|--------|
| Aus       | 2              | 1    | 1      | 2      |
| Eng       | 2              | 1    | 1      | 2      |
| India     | 2              | 2    | 0      | 4      |
| NZ        | 1              | 1    | 0      | 2      |
| SA        | 1              | 0    | 1      | 0      |
| SL        | 2              | 0    | 2      | 0      |

## Q12 - Seller's Second Item Brand Preference

Determine if the second item sold by each seller matches their favorite brand.

```sql
DROP TABLE IF EXISTS Users;
CREATE TABLE Users (
    user_id INT,
    join_date DATE,
    favorite_brand VARCHAR(50)
);

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
    order_id INT,
    order_date DATE,
    item_id INT,
    buyer_id INT,
    seller_id INT
);

DROP TABLE IF EXISTS items;
CREATE TABLE items (
    item_id INT,
    item_brand VARCHAR(50)
);

INSERT INTO Users VALUES 
(1, '2019-01-01', 'Lenovo'),
(2, '2019-02-09', 'Samsung'),
(3, '2019-01-19', 'LG'),
(4, '2019-05-21', 'HP');

INSERT INTO orders VALUES 
(1, '2019-08-01', 4, 1, 2),
(2, '2019-08-02', 2, 1, 3),
(3, '2019-08-03', 3, 2, 3),
(4, '2019-08-04', 1, 4, 2),
(5, '2019-08-04', 1, 3, 4),
(6, '2019-08-05', 2, 2, 4);

INSERT INTO items VALUES 
(1, 'Samsung'),
(2, 'Lenovo'),
(3, 'LG'),
(4, 'HP');

WITH CTE AS (
    SELECT 
        *,
        ROW_NUMBER() OVER (PARTITION BY seller_id ORDER BY order_date) AS rn
    FROM orders
),
CTE_1 AS (
    SELECT 
        c.order_id, 
        c.order_date, 
        c.item_id, 
        c.buyer_id, 
        COALESCE(c.seller_id, u.user_id) AS seller_id, 
        u.favorite_brand
    FROM CTE c
    RIGHT JOIN Users u 
        ON c.seller_id = u.user_id 
        AND c.rn = 2
),
CTE_2 AS (
    SELECT 
        c1.order_id, 
        c1.order_date, 
        c1.item_id, 
        c1.buyer_id, 
        c1.seller_id,
        CASE 
            WHEN c1.favorite_brand = i.item_brand THEN 'Yes' 
            ELSE 'No' 
        END AS is_favorite_brand
    FROM CTE_1 c1
    LEFT JOIN items i 
        ON c1.item_id = i.item_id
)
SELECT 
    seller_id, 
    COALESCE(is_favorite_brand, 'No') AS is_favorite_brand
FROM CTE_2
```

**Expected Output**:

| seller_id | is_favorite_brand |
|-----------|-------------------|
| 1         | No                |
| 2         | Yes               |
| 3         | Yes               |
| 4         | Yes               |

## Q13 - Missing Quarter for Each Store

Identify the missing quarter for each store based on sales data.

```sql
DROP TABLE IF EXISTS STORES;
CREATE TABLE STORES (
    Store VARCHAR(10),
    Quarter VARCHAR(10),
    Amount INT
);

INSERT INTO STORES (Store, Quarter, Amount) VALUES 
('S1', 'Q1', 200),
('S1', 'Q2', 300),
('S1', 'Q4', 400),
('S2', 'Q1', 500),
('S2', 'Q3', 600),
('S2', 'Q4', 700),
('S3', 'Q1', 800),
('S3', 'Q2', 750),
('S3', 'Q3', 900);

DECLARE @quarter_sum INT = 10;

SELECT 
    Store,
    CONCAT('Q', @quarter_sum - SUM(CAST(RIGHT(Quarter, 1) AS INT))) AS missing_quarter
FROM STORES
GROUP BY Store
```

**Expected Output**:

| Store | missing_quarter |
|-------|-----------------|
| S1    | Q3              |
| S2    | Q2              |
| S3    | Q4              |

## Q14 - Group Winners with Tiebreaker

Find the winner in each group, using the lowest player_id as a tiebreaker for identical scores.

```sql
DROP TABLE IF EXISTS players;
CREATE TABLE players (
    player_id INT,
    group_id INT
);

INSERT INTO players VALUES 
(15, 1),
(25, 1),
(30, 1),
(45, 1),
(10, 2),
(35, 2),
(50, 2),
(20, 3),
(40, 3);

DROP TABLE IF EXISTS matches;
CREATE TABLE matches (
    match_id INT,
    first_player INT,
    second_player INT,
    first_score INT,
    second_score INT
);

INSERT INTO matches VALUES 
(1, 15, 45, 3, 0),
(2, 30, 25, 1, 2),
(3, 30, 15, 2, 0),
(4, 40, 20, 5, 2),
(5, 35, 50, 1, 1);

WITH CTE AS (
    SELECT 
        match_id, 
        first_player AS player, 
        SUM(first_score) AS total_score
    FROM matches
    GROUP BY match_id, first_player
    UNION ALL
    SELECT 
        match_id, 
        second_player AS player, 
        SUM(second_score) AS total_score
    FROM matches
    GROUP BY match_id, second_player
),
CTE_1 AS (
    SELECT 
        player, 
        SUM(total_score) AS total_score, 
        group_id
    FROM CTE c
    JOIN players p
        ON c.player = p.player_id
    GROUP BY player, group_id
)
SELECT 
    group_id, 
    player AS player_id, 
    total_score 
FROM (
    SELECT 
        *,
        RANK() OVER(PARTITION BY group_id ORDER BY total_score DESC, player ASC) AS rnk
    FROM CTE_1
) subquery
WHERE rnk = 1
```

**Expected Output**:

| group_id | player_id | total_score |
|----------|-----------|-------------|
| 1        | 15        | 3           |
| 2        | 35        | 1           |
| 3        | 40        | 5           |

## Q15 - Consecutive Days with Low Stock

Find supplier_id and product_id with at least 2 consecutive days of stock quantity below 50.

```sql
DROP TABLE IF EXISTS stock;
CREATE TABLE stock (
    supplier_id INT,
    product_id INT,
    stock_quantity INT,
    record_date DATE
);

INSERT INTO stock (supplier_id, product_id, stock_quantity, record_date) VALUES
(1, 1, 60, '2022-01-01'),
(1, 1, 40, '2022-01-02'),
(1, 1, 35, '2022-01-03'),
(1, 1, 45, '2022-01-04'),
(1, 1, 51, '2022-01-06'),
(1, 1, 55, '2022-01-09'),
(1, 1, 25, '2022-01-10'),
(1, 1, 48, '2022-01-11'),
(1, 1, 45, '2022-01-15'),
(1, 1, 38, '2022-01-16'),
(1, 2, 45, '2022-01-08'),
(1, 2, 40, '2022-01-09'),
(2, 1, 45, '2022-01-06'),
(2, 1, 55, '2022-01-07'),
(2, 2, 45, '2022-01-08'),
(2, 2, 48, '2022-01-09'),
(2, 2, 35, '2022-01-10'),
(2, 2, 52, '2022-01-15'),
(2, 2, 23, '2022-01-16');

SELECT 
    supplier_id, 
    product_id, 
    COUNT(*) AS total_consecutive_count, 
    MIN(record_date) AS first_date
FROM (
    SELECT 
        supplier_id, 
        product_id, 
        stock_quantity, 
        record_date,
        ROW_NUMBER() OVER(PARTITION BY supplier_id, product_id ORDER BY record_date) AS rn,
        DATEDIFF(DAY, ROW_NUMBER() OVER(PARTITION BY supplier_id, product_id ORDER BY record_date), record_date) AS difference
    FROM stock
    WHERE stock_quantity < 50
) subquery
GROUP BY difference, supplier_id, product_id 
HAVING COUNT(difference) >= 2
```

**Expected Output**:

| supplier_id | product_id | total_consecutive_count | first_date  |
|-------------|------------|-------------------------|-------------|
| 1           | 1          | 3                       | 2022-01-02  |
| 1           | 1          | 2                       | 2022-01-10  |
| 1           | 1          | 2                       | 2022-01-15  |
| 1           | 2          | 2                       | 2022-01-08  |
| 2           | 2          | 3                       | 2022-01-08  |

## Q16 - Total Messages Exchanged Between Pairs

Calculate the total number of messages exchanged between each pair of people.

```sql
DROP TABLE IF EXISTS subscriber;
CREATE TABLE subscriber (
    sms_date DATE,
    sender VARCHAR(20),
    receiver VARCHAR(20),
    sms_no INT
);

INSERT INTO subscriber VALUES 
('2020-4-1', 'Avinash', 'Vibhor', 10),
('2020-4-1', 'Vibhor', 'Avinash', 20),
('2020-4-1', 'Avinash', 'Pawan', 30),
('2020-4-1', 'Pawan', 'Avinash', 20),
('2020-4-1', 'Vibhor', 'Pawan', 5),
('2020-4-1', 'Pawan', 'Vibhor', 8),
('2020-4-1', 'Vibhor', 'Deepak', 50);

WITH CTE AS (
    SELECT 
        sms_date, 
        CASE WHEN sender < receiver THEN sender ELSE receiver END AS P1,
        CASE WHEN receiver > sender THEN receiver ELSE sender END AS P2,
        sms_no
    FROM subscriber
)
SELECT 
    sms_date, 
    P1, 
    P2, 
    SUM(sms_no) AS total_exchanged_msgs
FROM CTE 
GROUP BY sms_date, P1, P2
```

**Expected Output**:

| sms_date   | P1      | P2      | total_exchanged_msgs |
|------------|---------|---------|----------------------|
| 2020-04-01 | Avinash | Pawan   | 50                   |
| 2020-04-01 | Avinash | Vibhor  | 30                   |
| 2020-04-01 | Deepak  | Vibhor  | 50                   |
| 2020-04-01 | Pawan   | Vibhor  | 13                   |

## Q17 - Most Commonly Purchased Product Pairs

Identify product pairs most commonly purchased together.

```sql
DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
    order_id INT,
    customer_id INT,
    product_id INT
);

INSERT INTO orders VALUES 
(1, 1, 1),
(1, 1, 2),
(1, 1, 3),
(2, 2, 1),
(2, 2, 2),
(2, 2, 4),
(3, 1, 5);

DROP TABLE IF EXISTS products_new;
CREATE TABLE products_new (
    id INT,
    name VARCHAR(10)
);

INSERT INTO products_new VALUES 
(1, 'A'),
(2, 'B'),
(3, 'C'),
(4, 'D'),
(5, 'E');

WITH CTE AS (
    SELECT 
        o.order_id, 
        o.product_id AS P1, 
        o1.product_id AS P2  
    FROM orders o
    JOIN orders o1
        ON o.order_id = o1.order_id
    WHERE o.product_id < o1.product_id
)
SELECT 
    pn.name + ' ' + pn1.name AS pair, 
    COUNT(*) AS freq
FROM CTE
JOIN products_new pn 
    ON P1 = pn.id
JOIN products_new pn1 
    ON P2 = pn1.id
GROUP BY pn.name, pn1.name
```

**Expected Output**:

| pair    | freq |
|---------|------|
| A B     | 2    |
| A C     | 1    |
| A D     | 1    |
| B C     | 1    |
| B D     | 1    |

## Q18 - Student Performance Analysis

Solve multiple queries related to student marks:
1. Students with above-average marks in each subject.
2. Percentage of students scoring above 90 in any subject.
3. Second highest and second lowest marks in each subject.
4. Mark increase or decrease for each student and test.

```sql
DROP TABLE IF EXISTS students;
CREATE TABLE students (
    studentid INT NULL,
    studentname VARCHAR(255) NULL,
    subject VARCHAR(255) NULL,
    marks INT NULL,
    testid INT NULL,
    testdate DATE NULL
);

INSERT INTO students VALUES 
(2, 'Max Ruin', 'Subject1', 63, 1, '2022-01-02'),
(3, 'Arnold', 'Subject1', 95, 1, '2022-01-02'),
(4, 'Krish Star', 'Subject1', 61, 1, '2022-01-02'),
(5, 'John Mike', 'Subject1', 91, 1, '2022-01-02'),
(4, 'Krish Star', 'Subject2', 71, 1, '2022-01-02'),
(3, 'Arnold', 'Subject2', 32, 1, '2022-01-02'),
(5, 'John Mike', 'Subject2', 61, 2, '2022-11-02'),
(1, 'John Deo', 'Subject2', 60, 1, '2022-01-02'),
(2, 'Max Ruin', 'Subject2', 84, 1, '2022-01-02'),
(2, 'Max Ruin', 'Subject3', 29, 3, '2022-01-03'),
(5, 'John Mike', 'Subject3', 98, 2, '2022-11-02');

-- 1. Students with above-average marks
SELECT 
    studentid, 
    studentname, 
    testid, 
    testdate 
FROM (
    SELECT 
        studentid, 
        studentname, 
        subject, 
        marks,
        AVG(marks) OVER(PARTITION BY subject) AS average_marks,
        testid, 
        testdate
    FROM students
) subquery
WHERE marks > average_marks
ORDER BY studentid;

-- 2. Percentage of students scoring above 90
SELECT 
    ROUND(COUNT(*) * 1.0 / (SELECT COUNT(*) FROM students) * 100, 2) AS percentage
FROM students
WHERE marks > 90;

-- 3. Second highest and second lowest marks
SELECT 
    studentid, 
    studentname, 
    subject, 
    marks, 
    testid, 
    testdate
FROM (
    SELECT 
        studentid, 
        studentname, 
        subject, 
        marks, 
        testid, 
        testdate,
        ROW_NUMBER() OVER (PARTITION BY subject ORDER BY marks) AS asc_rn,
        ROW_NUMBER() OVER (PARTITION BY subject ORDER BY marks DESC) AS desc_rn
    FROM students
) subquery
WHERE asc_rn = 2 OR desc_rn = 2;

-- 4. Mark increase or decrease
SELECT 
    *,
    CASE 
        WHEN marks > previous_marks THEN 'Increased' 
        WHEN previous_marks IS NULL THEN 'Previous Marks Not Present' 
        ELSE 'Decreased' 
    END AS status
FROM (
    SELECT 
        studentid, 
        studentname, 
        subject, 
        marks, 
        testid, 
        testdate,
        LAG(marks, 1) OVER(PARTITION BY studentid ORDER BY testdate) AS previous_marks
    FROM students
) subquery
```

**Expected Output**:

1. **Students with above-average marks**:

| studentid | studentname  | testid | testdate   |
|-----------|--------------|--------|------------|
| 3         | Arnold       | 1      | 2022-01-02 |
| 5         | John Mike    | 1      | 2022-01-02 |
| 2         | Max Ruin     | 1      | 2022-01-02 |
| 5         | John Mike    | 2      | 2022-11-02 |

2. **Percentage of students scoring above 90**:

| percentage |
|------------|
| 18.18      |

3. **Second highest and second lowest marks**:

| studentid | studentname  | subject   | marks | testid | testdate   |
|-----------|--------------|-----------|-------|--------|------------|
| 2         | Max Ruin     | Subject1  | 63    | 1      | 2022-01-02 |
| 4         | Krish Star   | Subject1  | 61    | 1      | 2022-01-02 |
| 5         | John Mike    | Subject2  | 61    | 2      | 2022-11-02 |
| 1         | John Deo     | Subject2  | 60    | 1      | 2022-01-02 |

4. **Mark increase or decrease**:

| studentid | studentname  | subject   | marks | testid | testdate   | previous_marks | status                     |
|-----------|--------------|-----------|-------|--------|------------|----------------|----------------------------|
| 1         | John Deo     | Subject2  | 60    | 1      | 2022-01-02 | NULL           | Previous Marks Not Present |
| 2         | Max Ruin     | Subject1  | 63    | 1      | 2022-01-02 | NULL           | Previous Marks Not Present |
| 2         | Max Ruin     | Subject2  | 84    | 1      | 2022-01-02 | 63             | Increased                  |
| 2         | Max Ruin     | Subject3  | 29    | 3      | 2022-01-03 | 84             | Decreased                  |
| 3         | Arnold       | Subject1  | 95    | 1      | 2022-01-02 | NULL           | Previous Marks Not Present |
| 3         | Arnold       | Subject2  | 32    | 1      | 2022-01-02 | 95             | Decreased                  |
| 4         | Krish Star   | Subject1  | 61    | 1      | 2022-01-02 | NULL           | Previous Marks Not Present |
| 4         | Krish Star   | Subject2  | 71    | 1      | 2022-01-02 | 61             | Increased                  |
| 5         | John Mike    | Subject1  | 91    | 1      | 2022-01-02 | NULL           | Previous Marks Not Present |
| 5         | John Mike    | Subject2  | 61    | 2      | 2022-11-02 | 91             | Decreased                  |
| 5         | John Mike    | Subject3  | 98    | 2      | 2022-11-02 | 61             | Increased                  |

## Q19 - Second Most Recent Activity

Find the second most recent activity for each user, or the only activity if they have just one.

```sql
DROP TABLE IF EXISTS UserActivity;
CREATE TABLE UserActivity (
    username VARCHAR(20),
    activity VARCHAR(20),
    startDate DATE,
    endDate DATE
);

INSERT INTO UserActivity VALUES 
('Alice', 'Travel', '2020-02-12', '2020-02-20'),
('Alice', 'Dancing', '2020-02-21', '2020-02-23'),
('Alice', 'Travel', '2020-02-24', '2020-02-28'),
('Bob', 'Travel', '2020-02-11', '2020-02-18'),
('Marie', 'Travel', '2020-02-11', '2020-02-18');

WITH RankedActivities AS (
    SELECT 
        username, 
        activity, 
        startDate,
        ROW_NUMBER() OVER (PARTITION BY username ORDER BY startDate DESC) AS rn
    FROM UserActivity
)
SELECT 
    username, 
    activity
FROM RankedActivities r
WHERE rn = 2
    OR NOT EXISTS (
        SELECT 1 
        FROM RankedActivities 
        WHERE username = r.username AND rn = 2
    )
```

**Expected Output**:

| username | activity |
|----------|----------|
| Alice    | Dancing  |
| Bob      | Travel   |
| Marie    | Travel   |

## Q20 - Students with Same Marks in Physics and Chemistry

Identify students with identical marks in Physics and Chemistry.

```sql
DROP TABLE IF EXISTS exams;
CREATE TABLE exams (
    student_id INT,
    subject VARCHAR(20),
    marks INT
);

INSERT INTO exams VALUES 
(1, 'Chemistry', 91),
(1, 'Physics', 91),
(2, 'Chemistry', 80),
(2, 'Physics', 90),
(3, 'Chemistry', 80),
(4, 'Chemistry', 71),
(4, 'Physics', 54);

SELECT 
    student_id, 
    marks
FROM exams
GROUP BY student_id, marks
HAVING COUNT(*) >= 2
```

**Expected Output**:

| student_id | marks |
|------------|-------|
| 1          | 91    |

## Q21 - User Purchase Platform Analysis

Calculate the total number of users and amount spent on mobile only, desktop only, and both platforms for each date.

```sql
DROP TABLE IF EXISTS spending;
CREATE TABLE spending (
    user_id INT,
    spend_date DATE,
    platform VARCHAR(10),
    amount_spent INT
);

INSERT INTO spending VALUES
(1, '2019-07-01', 'mobile', 100),
(1, '2019-07-01', 'desktop', 100),
(2, '2019-07-01', 'mobile', 100),
(2, '2019-07-02', 'mobile', 100),
(3, '2019-07-01', 'desktop', 100),
(3, '2019-07-02', 'desktop', 100);

WITH UserPlatforms AS (
    SELECT 
        user_id, 
        spend_date, 
        COUNT(DISTINCT platform) AS platform_count,
        SUM(CASE WHEN platform = 'mobile' THEN amount_spent ELSE 0 END) AS mobile_amount,
        SUM(CASE WHEN platform = 'desktop' THEN amount_spent ELSE 0 END) AS desktop_amount
    FROM spending
    GROUP BY user_id, spend_date
)
SELECT 
    spend_date,
    SUM(CASE WHEN platform_count = 1 AND mobile_amount > 0 THEN 1 ELSE 0 END) AS mobile_only_users,
    SUM(CASE WHEN platform_count = 1 AND desktop_amount > 0 THEN 1 ELSE 0 END) AS desktop_only_users,
    SUM(CASE WHEN platform_count = 2 THEN 1 ELSE 0 END) AS both_users,
    SUM(CASE WHEN platform_count = 1 AND mobile_amount > 0 THEN mobile_amount ELSE 0 END) AS total_amount_mobile,
    SUM(CASE WHEN platform_count = 1 AND desktop_amount > 0 THEN desktop_amount ELSE 0 END) AS total_amount_desktop,
    SUM(CASE WHEN platform_count = 2 THEN mobile_amount + desktop_amount ELSE 0 END) AS total_amount_both
FROM UserPlatforms
GROUP BY spend_date
```

**Expected Output**:

| spend_date | mobile_only_users | desktop_only_users | both_users | total_amount_mobile | total_amount_desktop | total_amount_both |
|------------|-------------------|--------------------|------------|---------------------|----------------------|-------------------|
| 2019-07-01 | 1                 | 1                  | 1          | 100                 | 100                  | 200               |
| 2019-07-02 | 1                 | 1                  | 0          | 100                 | 100                  | 0                 |

## Q22 - Persons with High-Scoring Friends

Find persons with friends whose total score exceeds 100.

```sql
DROP TABLE IF EXISTS person;
CREATE TABLE person (
    p_id INT,
    name VARCHAR(20),
    score INT
);

DROP TABLE IF EXISTS friend;
CREATE TABLE friend (
    p_id INT,
    f_id INT
);

INSERT INTO person VALUES 
(1, 'Ahsan', 88),
(2, 'Juel', 11),
(3, 'Jubayer', 27),
(4, 'Shakel', 45),
(5, 'Sunny', 63);

INSERT INTO friend VALUES 
(1, 2),
(1, 3),
(2, 1),
(2, 3),
(3, 5),
(4, 2),
(4, 3),
(4, 5);

SELECT 
    p.p_id, 
    p.name, 
    COUNT(f.f_id) AS total_friends, 
    SUM(fp.score) AS total_friends_score
FROM person p
JOIN friend f 
    ON p.p_id = f.p_id
JOIN person fp 
    ON f.f_id = fp.p_id
GROUP BY p.p_id, p.name
HAVING SUM(fp.score) > 100
```

**Expected Output**:

| p_id | name    | total_friends | total_friends_score |
|------|---------|---------------|---------------------|
| 4    | Shakel  | 3             | 101                 |

## Q23 - Populate Category with Last Non-Null Value

Propagate the last non-null category value to subsequent rows.

```sql
DROP TABLE IF EXISTS brands;
CREATE TABLE brands (
    category VARCHAR(20),
    brand_name VARCHAR(20)
);

INSERT INTO brands VALUES
('chocolates', '5-star'),
(NULL, 'dairy milk'),
(NULL, 'perk'),
(NULL, 'eclair'),
('Biscuits', 'britannia'),
(NULL, 'good day'),
(NULL, 'boost');

WITH cte_id_flag AS (
    SELECT 
        *, 
        ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) AS ID,
        CASE WHEN category IS NULL THEN 0 ELSE 1 END AS Flag 
    FROM brands
),
cte_groups AS (
    SELECT 
        *, 
        SUM(Flag) OVER(ORDER BY ID) AS Groups 
    FROM cte_id_flag
)
SELECT 
    DISTINCT FIRST_VALUE(category) OVER(PARTITION BY Groups ORDER BY ID) AS category, 
    brand_name
FROM cte_groups
```

**Expected Output**:

| category    | brand_name  |
|-------------|-------------|
| chocolates  | 5-star      |
| chocolates  | dairy milk  |
| chocolates  | perk        |
| chocolates  | eclair      |
| Biscuits    | britannia   |
| Biscuits    | good day    |
| Biscuits    | boost       |

## Q24 - Busiest Airline Route

Identify the busiest route based on total ticket count, considering round trips.

```sql
DROP TABLE IF EXISTS tickets;
CREATE TABLE tickets (
    airline_number VARCHAR(10),
    origin VARCHAR(3),
    destination VARCHAR(3),
    oneway_round CHAR(1),
    ticket_count INT
);

INSERT INTO tickets (airline_number, origin, destination, oneway_round, ticket_count) VALUES
('DEF456', 'BOM', 'DEL', 'O', 150),
('GHI789', 'DEL', 'BOM', 'R', 50),
('JKL012', 'BOM', 'DEL', 'R', 75),
('MNO345', 'DEL', 'NYC', 'O', 200),
('PQR678', 'NYC', 'DEL', 'O', 180),
('STU901', 'NYC', 'DEL', 'R', 60),
('ABC123', 'DEL', 'BOM', 'O', 100),
('VWX234', 'DEL', 'NYC', 'R', 90);

WITH CTE AS (
    SELECT 
        origin, 
        destination, 
        oneway_round, 
        ticket_count
    FROM tickets
    UNION ALL
    SELECT 
        destination, 
        origin, 
        oneway_round, 
        ticket_count
    FROM tickets
    WHERE oneway_round = 'R'
)
SELECT TOP 1 
    origin, 
    destination, 
    SUM(ticket_count) AS ticket_count
FROM CTE
GROUP BY origin, destination
ORDER BY ticket_count DESC
```

**Expected Output**:

| origin | destination | ticket_count |
|--------|-------------|--------------|
| DEL    | NYC         | 530          |

## Q25 - Date Difference Excluding Weekends and Holidays

Calculate the difference between two dates, excluding weekends and public holidays.

```sql
DROP TABLE IF EXISTS tickets;
CREATE TABLE tickets (
    ticket_id VARCHAR(10),
    create_date DATE,
    resolved_date DATE
);

INSERT INTO tickets VALUES
('1', '2022-08-01', '2022-08-03'),
('2', '2022-08-01', '2022-08-12'),
('3', '2022-08-01', '2022-08-16');

DROP TABLE IF EXISTS holidays;
CREATE TABLE holidays (
    holiday_date DATE,
    reason VARCHAR(100)
);

INSERT INTO holidays VALUES
('2022-08-11', 'Rakhi'),
('2022-08-15', 'Independence day');

WITH DateRange AS (
    SELECT 
        ticket_id,
        create_date,
        resolved_date,
        DATEDIFF(DAY, create_date, resolved_date) + 1 AS total_days
    FROM tickets
),
Weekdays AS (
    SELECT 
        ticket_id,
        create_date,
        resolved_date,
        total_days,
        (total_days - DATEDIFF(WEEK, create_date, resolved_date) * 2) AS weekdays
    FROM DateRange
),
Holidays AS (
    SELECT 
        t.ticket_id,
        COUNT(h.holiday_date) AS holiday_count
    FROM tickets t
    LEFT JOIN holidays h
        ON h.holiday_date BETWEEN t.create_date AND t.resolved_date
        AND DATEPART(WEEKDAY, h.holiday_date) NOT IN (1, 7)
    GROUP BY t.ticket_id
)
SELECT 
    w.ticket_id,
    w.create_date,
    w.resolved_date,
    w.weekdays - ISNULL(h.holiday_count, 0) AS days_difference
FROM Weekdays w
LEFT JOIN Holidays h
    ON w.ticket_id = h.ticket_id
```

**Expected Output**:

| ticket_id | create_date | resolved_date | days_difference |
|-----------|-------------|---------------|-----------------|
| 1         | 2022-08-01  | 2022-08-03    | 3               |
| 2         | 2022-08-01  | 2022-08-12    | 8               |
| 3         | 2022-08-01  | 2022-08-16    | 9               |

## Q26 - Highest Votes Per Month

Find the candidate with the highest number of votes each month, using the lowest CandidateID as a tiebreaker.

```sql
DROP TABLE IF EXISTS Elections;
CREATE TABLE Elections (
    CandidateID INT,
    VoterID INT,
    VoteDate DATE
);

INSERT INTO Elections (CandidateID, VoterID, VoteDate) VALUES
(1, 101, '2023-01-10'),
(2, 102, '2023-01-15'),
(1, 103, '2023-01-20'),
(2, 104, '2023-01-25'),
(3, 105, '2023-01-30'),
(1, 106, '2023-02-05'),
(2, 107, '2023-02-10'),
(1, 108, '2023-02-15'),
(1, 109, '2023-02-20'),
(3, 110, '2023-02-25'),
(2, 111, '2023-03-01'),
(1, 112, '2023-03-05'),
(2, 113, '2023-03-10'),
(3, 114, '2023-03-15'),
(3, 115, '2023-03-20'),
(1, 116, '2023-03-25'),
(1, 117, '2023-03-30');

WITH CTE AS (
    SELECT 
        FORMAT(VoteDate, 'yyyy-MM') AS Year_date, 
        CandidateID, 
        COUNT(*) AS vote_count
    FROM Elections
    GROUP BY FORMAT(VoteDate, 'yyyy-MM'), CandidateID
),
CTE_1 AS (
    SELECT 
        Year_date, 
        CandidateID,
        vote_count AS VoteCount,
        RANK() OVER (PARTITION BY Year_date ORDER BY vote_count DESC, CandidateID) AS rnk
    FROM CTE
)
SELECT 
    Year_date, 
    CandidateID,
    VoteCount
FROM CTE_1
WHERE rnk = 1
```

**Expected Output**:

| Year_date | CandidateID | VoteCount |
|-----------|-------------|-----------|
| 2023-01   | 1           | 2         |
| 2023-02   | 1           | 3         |
| 2023-03   | 1           | 3         |

## Q27 - Genres Without Movies

Identify genres that have no associated movies.

```sql
DROP TABLE IF EXISTS Movies;
CREATE TABLE Movies (
    MovieID INT PRIMARY KEY,
    Title NVARCHAR(100),
    ReleaseDate DATE,
    GenreID INT
);

DROP TABLE IF EXISTS Genres;
CREATE TABLE Genres (
    GenreID INT PRIMARY KEY,
    GenreName NVARCHAR(50)
);

INSERT INTO Movies (MovieID, Title, ReleaseDate, GenreID) VALUES
(1, 'Inception', '2010-07-16', 1),
(2, 'The Dark Knight', '2008-07-18', 1),
(3, 'Interstellar', '2014-11-07', 1),
(4, 'Pulp Fiction', '1994-10-14', 2),
(5, 'The Shawshank Redemption', '1994-09-23', 3);

INSERT INTO Genres (GenreID, GenreName) VALUES
(1, 'Sci-Fi'),
(2, 'Crime'),
(3, 'Drama'),
(4, 'Comedy'),
(5, 'Horror');

SELECT 
    GenreID, 
    GenreName
FROM Genres
WHERE GenreID NOT IN (
    SELECT GenreID 
    FROM Movies
)
```

**Expected Output**:

| GenreID | GenreName |
|---------|-----------|
| 4       | Comedy    |
| 5       | Horror    |

## Q28 - Students Missing Consecutive Classes

Identify students who missed more than 3 consecutive classes.

```sql
DROP TABLE IF EXISTS Attendance;
CREATE TABLE Attendance (
    StudentID INT,
    ClassDate DATE,
    IsPresent BIT
);

INSERT INTO Attendance (StudentID, ClassDate, IsPresent) VALUES
(1, '2023-05-01', 1),
(1, '2023-05-02', 0),
(1, '2023-05-03', 0),
(1, '2023-05-04', 0),
(1, '2023-05-05', 0),
(2, '2023-05-01', 1),
(2, '2023-05-02', 1),
(2, '2023-05-03', 1),
(2, '2023-05-04', 0),
(2, '2023-05-05', 0),
(3, '2023-05-01', 0),
(3, '2023-05-02', 0),
(3, '2023-05-03', 1),
(3, '2023-05-04', 0),
(3, '2023-05-05', 0),
(4, '2023-05-01', 0),
(4, '2023-05-02', 0),
(4, '2023-05-03', 0),
(4, '2023-05-04', 0),
(4, '2023-05-05', 1);

WITH CTE AS (
    SELECT 
        StudentID, 
        ClassDate, 
        IsPresent,
        ROW_NUMBER() OVER (PARTITION BY StudentID ORDER BY ClassDate) AS rn,
        ROW_NUMBER() OVER (PARTITION BY StudentID, IsPresent ORDER BY ClassDate) AS group_rn
    FROM Attendance
    WHERE IsPresent = 0
)
SELECT 
    StudentID,
    MIN(ClassDate) AS start_date,
    MAX(ClassDate) AS end_date,
    COUNT(*) AS missed_days
FROM CTE
GROUP BY StudentID, (rn - group_rn)
HAVING COUNT(*) > 3
```

**Expected Output**:

| StudentID | start_date  | end_date    | missed_days |
|-----------|-------------|-------------|-------------|
| 1         | 2023-05-02  | 2023-05-05  | 4           |
| 4         | 2023-05-01  | 2023-05-04  | 4           |

## Q29 - Two Consecutive Empty Seats

Find pairs of two consecutive empty seats.

```sql
DROP TABLE IF EXISTS bms;
CREATE TABLE bms (
    seat_no INT,
    is_empty CHAR(1)
);

INSERT INTO bms VALUES
(1, 'Y'),
(2, 'Y'),
(3, 'N'),
(4, 'Y'),
(5, 'Y'),
(6, 'N'),
(7, 'Y'),
(8, 'Y'),
(9, 'Y');

WITH CTE AS (
    SELECT 
        seat_no,
        is_empty,
        ROW_NUMBER() OVER (ORDER BY seat_no) AS Row_No,
        seat_no - ROW_NUMBER() OVER (ORDER BY seat_no) AS empty_seats
    FROM bms
    WHERE is_empty = 'Y'
),
CTE_1 AS (
    SELECT 
        empty_seats,
        MIN(seat_no) AS Start_Seat,
        COUNT(*) AS empty_seats_count
    FROM CTE
    GROUP BY empty_seats
    HAVING COUNT(*) = 2
)
SELECT 
    seat_no 
FROM CTE c 
JOIN CTE_1 c1
    ON c.empty_seats = c1.empty_seats 
    AND c.seat_no = c1.Start_Seat
```

**Expected Output**:

| seat_no |
|---------|
| 1       |
| 4       |

## Q30 - Lift Passenger Allocation

Assign passengers to lifts based on weight capacity.

```sql
DROP TABLE IF EXISTS LIFT;
CREATE TABLE LIFT (
    ID INT,
    Capacity INT
);

INSERT INTO LIFT (ID, Capacity) VALUES 
(1, 300),
(2, 350);

DROP TABLE IF EXISTS LIFT_PASSENGER;
CREATE TABLE LIFT_PASSENGER (
    Name VARCHAR(50),
    Weight INT,
    Lift_id INT
);

INSERT INTO LIFT_PASSENGER (Name, Weight, Lift_id) VALUES 
('Rahul', 85, 1),
('Adarsh', 73, 1),
('Riti', 95, 1),
('Dheeraj', 80, 1),
('Vimal', 83, 2),
('Neha', 77, 2),
('Priti', 73, 2),
('Himanshi', 85, 2);

WITH CTE AS (
    SELECT 
        l.ID, 
        lp.Name, 
        lp.Weight,
        SUM(lp.Weight) OVER(PARTITION BY l.ID ORDER BY lp.Weight) AS cum_sum,
        CASE 
            WHEN l.Capacity >= SUM(lp.Weight) OVER(PARTITION BY l.ID ORDER BY lp.Weight) THEN 1 
            ELSE 0 
        END AS flag
    FROM LIFT l 
    JOIN LIFT_PASSENGER lp
        ON l.ID = lp.Lift_id
)
SELECT 
    ID, 
    STRING_AGG(Name, ', ') AS Passengers
FROM CTE
WHERE flag = 1
GROUP BY ID
```

**Expected Output**:

| ID | Passengers             |
|----|------------------------|
| 1  | Adarsh, Dheeraj, Rahul |
| 2  | Priti, Neha, Vimal     |

## Q31 - Employee Office Hours

Calculate total and productive office hours for employees based on swipe data.

```sql
DROP TABLE IF EXISTS Swipes;
CREATE TABLE Swipes (
    employee_id INT,
    activity_type VARCHAR(20),
    activity_time DATETIME
);

INSERT INTO Swipes VALUES 
(1, 'login', '2024-07-23 08:00:00'),
(1, 'logout', '2024-07-23 12:00:00'),
(1, 'login', '2024-07-23 13:00:00'),
(1, 'logout', '2024-07-23 17:00:00'),
(2, 'login', '2024-07-23 09:00:00'),
(2, 'logout', '2024-07-23 11:00:00'),
(2, 'login', '2024-07-23 12:00:00'),
(2, 'logout', '2024-07-23 15:00:00'),
(1, 'login', '2024-07-24 08:30:00'),
(1, 'logout', '2024-07-24 12:30:00'),
(2, 'login', '2024-07-24 09:30:00'),
(2, 'logout', '2024-07-24 10:30:00');

WITH productive_hours AS (
    SELECT 
        employee_id,
        CAST(activity_time AS DATE) AS activity_day,
        MIN(CASE WHEN activity_type = 'login' THEN activity_time END) AS min_login_time,
        MAX(CASE WHEN activity_type = 'logout' THEN activity_time END) AS max_logout_time,
        SUM(DATEDIFF(HOUR, activity_time, 
            LEAD(activity_time) OVER(PARTITION BY employee_id, CAST(activity_time AS DATE) ORDER BY activity_time))) AS productive_hours
    FROM Swipes
    WHERE activity_type = 'login'
    GROUP BY employee_id, CAST(activity_time AS DATE)
)
SELECT 
    employee_id, 
    activity_day,
    DATEDIFF(HOUR, min_login_time, max_logout_time) AS total_hours,
    productive_hours
FROM productive_hours
```

**Expected Output**:

| employee_id | activity_day | total_hours | productive_hours |
|-------------|--------------|-------------|------------------|
| 1           | 2024-07-23   | 9           | 8                |
| 1           | 2024-07-24   | 4           | 4                |
| 2           | 2024-07-23   | 6           | 5                |
| 2           | 2024-07-24   | 1           | 1                |

## Q32 - Server Utilization Time

Calculate the total running time of a fleet of servers in full days.

```sql
DROP TABLE IF EXISTS server_sessions;
CREATE TABLE server_sessions (
    server_id INT,
    session_status VARCHAR(10),
    status_time DATETIME
);

INSERT INTO server_sessions (server_id, session_status, status_time) VALUES
(1, 'start', '2022-08-02 10:00:00'),
(1, 'stop', '2022-08-04 10:00:00'),
(1, 'start', '2022-08-13 10:00:00'),
(1, 'stop', '2022-08-13 19:00:00'),
(3, 'start', '2022-08-06 10:00:00'),
(3, 'stop', '2022-08-14 10:00:00'),
(3, 'start', '2022-08-18 10:00:00'),
(3, 'stop', '2022-08-19 10:00:00'),
(2, 'start', '2022-08-17 10:00:00'),
(2, 'stop', '2022-08-24 10:00:00'),
(4, 'start', '2022-08-16 10:00:00'),
(4, 'stop', '2022-08-19 14:00:00'),
(5, 'start', '2022-08-14 21:00:00'),
(5, 'stop', '2022-08-19 10:00:00');

WITH ranked_start_sessions AS (
    SELECT 
        server_id, 
        status_time AS start_time,
        ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY status_time) AS rn_start
    FROM server_sessions
    WHERE session_status = 'start'
),
ranked_stop_sessions AS (
    SELECT 
        server_id, 
        status_time AS stop_time,
        ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY status_time) AS rn_stop
    FROM server_sessions
    WHERE session_status = 'stop'
)
SELECT 
    SUM(DATEDIFF(DAY, start_time, stop_time)) AS total_running_days
FROM ranked_start_sessions s1
JOIN ranked_stop_sessions s2
    ON s1.server_id = s2.server_id
    AND s1.rn_start = s2.rn_stop
```

**Expected Output**:

| total_running_days |
|--------------------|
| 19                 |

## Q33 - Orders with Same SKU Combinations

Find the total number of orders for each combination of SKUs per day.

```sql
DROP TABLE IF EXISTS Ordertable;
CREATE TABLE Ordertable (
    OrderID INT,
    OrderDate DATE,
    UserID INT,
    Sku1 VARCHAR(10),
    Sku2 VARCHAR(10),
    Sku3 VARCHAR(10)
);

INSERT INTO Ordertable (OrderID, OrderDate, UserID, Sku1, Sku2, Sku3) VALUES
(1, '2024-07-01', 101, 'A123', 'B456', 'C789'),
(2, '2024-07-01', 102, 'B456', 'C789', 'A123'),
(3, '2024-07-01', 102, 'G678', 'H123', 'I456'),
(4, '2024-07-01', 103, 'I456', 'G678', 'H123'),
(5, '2024-07-01', 104, 'H123', 'G678', 'I456'),
(6, '2024-07-02', 105, 'C789', 'A123', 'B456'),
(7, '2024-07-02', 106, 'B456', 'A123', 'C789'),
(8, '2024-07-03', 107, 'A123', 'C789', 'B456'),
(9, '2024-07-04', 101, 'D123', 'E456', 'F789');

WITH NormalizedOrders AS (
    SELECT 
        OrderID, 
        OrderDate, 
        UserID, 
        CASE 
            WHEN Sku1 < Sku2 AND Sku1 < Sku3 THEN Sku1
            WHEN Sku2 < Sku1 AND Sku2 < Sku3 THEN Sku2
            ELSE Sku3
        END AS Sku1_normalized,
        CASE 
            WHEN (Sku1 > Sku2 AND Sku1 < Sku3) OR (Sku1 < Sku2 AND Sku1 > Sku3) THEN Sku1
            WHEN (Sku2 > Sku1 AND Sku2 < Sku3) OR (Sku2 < Sku1 AND Sku2 > Sku3) THEN Sku2
            ELSE Sku3
        END AS Sku2_normalized,
        CASE 
            WHEN Sku1 > Sku2 AND Sku1 > Sku3 THEN Sku1
            WHEN Sku2 > Sku1 AND Sku2 > Sku3 THEN Sku2
            ELSE Sku3
        END AS Sku3_normalized
    FROM Ordertable
)
SELECT 
    OrderDate,
    CONCAT(Sku1_normalized, ',', Sku2_normalized, ',', Sku3_normalized) AS Skus,
    COUNT(*) AS OrderCount
FROM NormalizedOrders
GROUP BY OrderDate, Sku1_normalized, Sku2_normalized, Sku3_normalized
ORDER BY OrderDate, Sku1_normalized, Sku2_normalized, Sku3_normalized
```

**Expected Output**:

| OrderDate  | Skus                | OrderCount |
|------------|---------------------|------------|
| 2024-07-01 | A123,B456,C789      | 2          |
| 2024-07-01 | G678,H123,I456      | 3          |
| 2024-07-02 | A123,B456,C789      | 2          |
| 2024-07-03 | A123,B456,C789      | 1          |
| 2024-07-04 | D123,E456,F789      | 1          |


## Q34 - Penultimate Order Details

Retrieve the details of the penultimate order for each customer, or the only order if they have just one.

```sql
DROP TABLE IF EXISTS penultimate;
CREATE TABLE penultimate (
    order_id INT PRIMARY KEY,
    order_date DATE,
    customer_name VARCHAR(50),
    product_name VARCHAR(50),
    sales DECIMAL(10, 2)
);

INSERT INTO penultimate (order_id, order_date, customer_name, product_name, sales) VALUES
(1, '2023-01-01', 'Alexa', 'iphone', 100.00),
(2, '2023-01-02', 'Alexa', 'boAt', 300.00),
(3, '2023-01-03', 'Alexa', 'Rolex', 400.00),
(4, '2023-01-01', 'Ramesh', 'Titan', 200.00),
(5, '2023-01-02', 'Ramesh', 'Shirt', 300.00),
(6, '2023-01-03', 'Neha', 'Dress', 100.00);

WITH CTE AS (
    SELECT 
        *, 
        ROW_NUMBER() OVER (PARTITION BY customer_name ORDER BY order_date DESC) AS rn,
        COUNT(*) OVER (PARTITION BY customer_name) AS cnt
    FROM penultimate
)
SELECT 
    order_id, 
    order_date, 
    customer_name, 
    product_name, 
    sales
FROM CTE 
WHERE rn = CASE 
              WHEN cnt = 1 THEN 1 
              ELSE 2 
           END
ORDER BY customer_name
```

## Q35 - Last Price Carried to Next Month

Print the last price of each month carried forward to the first of the next month.

```sql
DROP TABLE IF EXISTS sku;
CREATE TABLE sku (
    sku_id INT,
    price_date DATE,
    price INT
);

INSERT INTO sku VALUES 
(1, '2023-01-01', 10),
(1, '2023-02-15', 15),
(1, '2023-03-03', 18),
(1, '2023-03-27', 15),
(1, '2023-04-06', 20);

WITH CTE AS (
    SELECT 
        sku_id, 
        price_date, 
        price,
        ROW_NUMBER() OVER(PARTITION BY MONTH(price_date) ORDER BY price_date DESC) AS rn
    FROM sku
)
SELECT 
    sku_id, 
    price_date, 
    price 
FROM sku
WHERE DAY(price_date) = 1
UNION ALL
SELECT 
    sku_id,
    DATEADD(MONTH, 1, DATE_TRUNC('MONTH', price_date)) AS price_date, 
    price
FROM CTE 
WHERE rn = 1
```

## Q36 - Team Qualification Based on Criteria

Determine if teams qualify based on having at least two members meeting both criteria.

```sql
DROP TABLE IF EXISTS Ameriprise_LLC;
CREATE TABLE Ameriprise_LLC (
    teamID VARCHAR(2),
    memberID VARCHAR(10),
    Criteria1 VARCHAR(1),
    Criteria2 VARCHAR(1)
);

INSERT INTO Ameriprise_LLC VALUES 
('T1', 'T1_mbr1', 'Y', 'Y'),
('T1', 'T1_mbr2', 'Y', 'Y'),
('T1', 'T1_mbr3', 'Y', 'Y'),
('T1', 'T1_mbr4', 'Y', 'Y'),
('T1', 'T1_mbr5', 'Y', 'N'),
('T2', 'T2_mbr1', 'Y', 'Y'),
('T2', 'T2_mbr2', 'Y', 'N'),
('T2', 'T2_mbr3', 'N', 'Y'),
('T2', 'T2_mbr4', 'N', 'N'),
('T2', 'T2_mbr5', 'N', 'N'),
('T3', 'T3_mbr1', 'Y', 'Y'),
('T3', 'T3_mbr2', 'Y', 'Y'),
('T3', 'T3_mbr3', 'N', 'Y'),
('T3', 'T3_mbr4', 'N', 'Y'),
('T3', 'T3_mbr5', 'Y', 'N');

SELECT 
    teamID, 
    memberID, 
    Criteria1, 
    Criteria2,
    CASE 
        WHEN Criteria1 = 'Y' AND Criteria2 = 'Y' AND 
             COUNT(CASE WHEN Criteria1 = 'Y' AND Criteria2 = 'Y' THEN 1 END) OVER(PARTITION BY teamID) >= 2 
        THEN 'Y' 
        ELSE 'N' 
    END AS qualify
FROM Ameriprise_LLC
```

## Q37 - Page Recommendations for Friends

Recommend pages liked by friends but not by the user.

```sql
DROP TABLE IF EXISTS friends;
CREATE TABLE friends (
    user_id INT,
    friend_id INT
);

INSERT INTO friends VALUES
(1, 2),
(1, 3),
(1, 4),
(2, 1),
(3, 1),
(3, 4),
(4, 1),
(4, 3);

DROP TABLE IF EXISTS likes;
CREATE TABLE likes (
    user_id INT,
    page_id CHAR(1)
);

INSERT INTO likes VALUES
(1, 'A'),
(1, 'B'),
(1, 'C'),
(2, 'A'),
(3, 'B'),
(3, 'C'),
(4, 'B');

WITH user_pages AS (
    SELECT DISTINCT 
        f.user_id, 
        l.page_id
    FROM friends f 
    JOIN likes l 
        ON f.user_id = l.user_id
),
friend_pages AS (
    SELECT DISTINCT 
        f.user_id, 
        f.friend_id, 
        l.page_id
    FROM friends f
    JOIN likes l
        ON f.friend_id = l.user_id
)
SELECT DISTINCT 
    fp.user_id, 
    fp.page_id
FROM friend_pages fp
LEFT JOIN user_pages up 
    ON fp.user_id = up.user_id 
    AND fp.page_id = up.page_id
WHERE up.user_id IS NULL
ORDER BY fp.user_id
```

## Q38 - Department Salary Comparison

Compare each department’s average salary with the company’s average salary excluding that department.

```sql
DROP TABLE IF EXISTS PayPal_salary;
CREATE TABLE PayPal_salary (
    emp_id INT,
    emp_name VARCHAR(20),
    department_id INT,
    salary INT,
    manager_id INT,
    emp_age INT
);

INSERT INTO PayPal_salary VALUES 
(1, 'Ankit', 100, 10000, 4, 39),
(2, 'Mohit', 100, 15000, 5, 48),
(3, 'Vikas', 100, 10000, 4, 37),
(4, 'Rohit', 100, 5000, 2, 16),
(5, 'Mudit', 200, 12000, 6, 55),
(6, 'Agam', 200, 12000, 2, 14),
(7, 'Sanjay', 200, 9000, 2, 13),
(8, 'Ashish', 200, 5000, 2, 12),
(9, 'Mukesh', 300, 6000, 6, 51),
(10, 'Rakesh', 300, 7000, 6, 50);

WITH CTE AS (
    SELECT 
        department_id, 
        AVG(salary) AS average_dept_salary, 
        COUNT(*) AS no_of_employees, 
        SUM(salary) AS total_dept_salary
    FROM PayPal_salary
    GROUP BY department_id
)
SELECT 
    c1.department_id, 
    c1.average_dept_salary,
    SUM(c2.no_of_employees) AS no_of_employees, 
    SUM(c2.total_dept_salary) AS total_dept_salary,
    SUM(c2.total_dept_salary) / SUM(c2.no_of_employees) AS company_avg_salary
FROM CTE c1 
JOIN CTE c2 
    ON c1.department_id != c2.department_id
GROUP BY c1.department_id, c1.average_dept_salary
ORDER BY c1.department_id
```

## Q39 - Running Total of Transactions

Calculate the running total of transactions, accounting for deposits and withdrawals.

```sql
DROP TABLE IF EXISTS transactions;
CREATE TABLE transactions (
    transaction_id INT,
    type VARCHAR(50),
    amount INT,
    transaction_date DATE
);

INSERT INTO transactions VALUES 
(53151, 'deposit', 178, '2022-07-08'),
(29776, 'withdrawal', 25, '2022-07-08'),
(16461, 'withdrawal', 45, '2022-07-08'),
(19153, 'deposit', 65, '2022-07-10'),
(77134, 'deposit', 32, '2022-07-10');

SELECT 
    *,
    SUM(CASE 
            WHEN type = 'deposit' THEN amount 
            ELSE -amount 
        END) OVER (ORDER BY transaction_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rolling_total
FROM transactions
```

## Q40 - Destination City

Find the final destination city for each customer’s travel path.

```sql
DROP TABLE IF EXISTS travel_data;
CREATE TABLE travel_data (
    customer VARCHAR(10),
    start_loc VARCHAR(50),
    end_loc VARCHAR(50)
);

INSERT INTO travel_data (customer, start_loc, end_loc) VALUES
('c1', 'New York', 'Lima'),
('c1', 'London', 'New York'),
('c1', 'Lima', 'Sao Paulo'),
('c1', 'Sao Paulo', 'New Delhi'),
('c2', 'Mumbai', 'Hyderabad'),
('c2', 'Surat', 'Pune'),
('c2', 'Hyderabad', 'Surat'),
('c3', 'Kochi', 'Kurnool'),
('c3', 'Lucknow', 'Agra'),
('c3', 'Agra', 'Jaipur'),
('c3', 'Jaipur', 'Kochi');

WITH end_location AS (
    SELECT 
        customer, 
        end_loc
    FROM travel_data 
    WHERE end_loc NOT IN (
        SELECT DISTINCT start_loc 
        FROM travel_data
    )
)
SELECT 
    customer, 
    end_loc AS destination
FROM end_location
```

## Q41 - Uber Profit Rides

Calculate total and profit rides for each Uber driver.

```sql
DROP TABLE IF EXISTS uber_profit_rides;
CREATE TABLE uber_profit_rides (
    ID VARCHAR(10),
    start_time TIME,
    end_time TIME,
    start_loc VARCHAR(5),
    end_loc VARCHAR(5)
);

INSERT INTO uber_profit_rides VALUES 
('dri_1', '9:00:00', '9:30:00', 'a', 'b'),
('dri_1', '9:30:00', '10:30:00', 'b', 'c'),
('dri_1', '11:00:00', '11:30:00', 'd', 'e'),
('dri_1', '12:00:00', '12:30:00', 'f', 'g'),
('dri_1', '12:30:00', '14:30:00', 'c', 'h'),
('dri_2', '12:15:00', '12:30:00', 'f', 'g'),
('dri_2', '12:30:00', '14:30:00', 'c', 'h');

SELECT 
    upf.ID, 
    COUNT(upf.ID) AS total_rides,
    SUM(CASE 
            WHEN upf.start_time = prev_ride.end_time 
                 AND upf.start_loc = prev_ride.end_loc 
            THEN 1 
            ELSE 0 
        END) AS profit_rides
FROM uber_profit_rides upf
LEFT JOIN uber_profit_rides prev_ride
    ON upf.ID = prev_ride.ID
    AND upf.start_time = prev_ride.end_time
    AND upf.start_loc = prev_ride.end_loc
GROUP BY upf.ID
ORDER BY upf.ID
```

## Q42 - Print Numbers by Their Value

Print each number in a table as many times as its value.

```sql
DROP TABLE IF EXISTS zepto;
CREATE TABLE zepto (
    input INT
);

INSERT INTO zepto VALUES 
(1), (2), (3), (4), (5);

WITH CTE AS (
    SELECT 
        input, 
        1 AS num_counter
    FROM zepto
    UNION ALL 
    SELECT 
        input, 
        num_counter + 1 AS num_counter
    FROM CTE
    WHERE num_counter + 1 <= input
)
SELECT input 
FROM CTE 
ORDER BY input
```

## Q43 - Max and Min Population Cities by State

Identify the cities with the maximum and minimum population in each state.

```sql
DROP TABLE IF EXISTS city_population;
CREATE TABLE city_population (
    state VARCHAR(50),
    city VARCHAR(50),
    population INT
);

INSERT INTO city_population (state, city, population) VALUES 
('Uttar Pradesh', 'Mau', 600),
('Uttar Pradesh', 'Lucknow', 500),
('Uttar Pradesh', 'Agra', 700),
('Bihar', 'Gaya', 700),
('Bihar', 'Patna', 800),
('Bihar', 'Samastipur', 500),
('Karnataka', 'Bangalore', 750),
('Karnataka', 'Udupi', 300),
('Karnataka', 'Kolar', 500),
('Maharashtra', 'Shirur', 300),
('Maharashtra', 'Pune', 500),
('Maharashtra', 'Mumbai', 1400),
('Orrisa', 'Rourkela', 100),
('Orrisa', 'Bhubaneshwar', 400),
('Orrisa', 'Cuttack', 300),
('Haryana', 'Gurgaon', 500),
('Haryana', 'Bhiwani', 300),
('Haryana', 'Faridabad', 400);

WITH population AS (
    SELECT 
        state,
        MIN(population) AS min_population, 
        MAX(population) AS max_population
    FROM city_population
    GROUP BY state
)
SELECT 
    cp.state,
    MAX(CASE WHEN cp.population = p.max_population THEN cp.city END) AS max_population_city,
    p.max_population,
    MIN(CASE WHEN cp.population = p.min_population THEN cp.city
